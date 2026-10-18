; Localserve's per-user installer consumes only a verified clean payload.
; Private files are initialized separately and retained by default on removal.
#ifndef ProductId
  #define ProductId "Localserve.Windows"
#endif
#ifndef ShortcutGroup
  #define ShortcutGroup "Localserve"
#endif
[Setup]
AppId={#ProductId}
AppName=Localserve
AppVersion={#AppVersion}
AppPublisher=Localserve
DefaultDirName={localappdata}\Programs\Localserve
DefaultGroupName={#ShortcutGroup}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible and not arm64
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupMutex=Local\LocalserveSetup
DisableWelcomePage=yes
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
WizardStyle=modern
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=no
RestartApplications=no
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile={#Payload}\tray\assets\logo.ico
UninstallDisplayIcon={app}\tray\LocalserveTray.exe
UninstallDisplayName=Localserve
UninstallFilesDir={app}\uninstall
UsePreviousTasks=yes
[Tasks]
Name: startup; Description: "Start Localserve when I sign in"; Flags: unchecked
[Files]
Source: "{#Payload}\tray\LocalserveTray.exe"; Flags: dontcopy
#include FileList
[Icons]
Name: "{group}\Localserve"; Filename: "{app}\tray\LocalserveTray.exe"; Parameters: "--open"; WorkingDir: "{app}"
Name: "{group}\Uninstall Localserve"; Filename: "{uninstallexe}"
[Run]
Filename: "{app}\tray\LocalserveTray.exe"; Parameters: "--enable-startup"; Tasks: startup; Flags: runhidden waituntilterminated
Filename: "{app}\tray\LocalserveTray.exe"; Parameters: "--open"; Description: "Open Localserve"; Flags: nowait postinstall skipifsilent
[Code]
const
  Marker = '{"product":"localserve-windows","schemaVersion":1}';
var
  Maintenance: THandle;
  RemovePrivate: Boolean;

function CreateMutex(lpAttributes: LongWord; InitialOwner: Boolean; Name: String): THandle;
  external 'CreateMutexW@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';
function GetFileAttributes(Name: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

procedure ReleaseMaintenance;
begin
  if Maintenance <> 0 then begin CloseHandle(Maintenance); Maintenance := 0; end;
end;

function HasLinks(const Folder: String; var Count: Integer): Boolean;
var Find: TFindRec;
begin
  Result := False;
  if (GetFileAttributes(Folder) and $400) <> 0 then begin Result := True; exit; end;
  if FindFirst(AddBackslash(Folder) + '*', Find) then begin
    try
      repeat
        if (Find.Name <> '.') and (Find.Name <> '..') then begin
          Count := Count + 1;
          if (Count > 100000) or ((Find.Attributes and $400) <> 0) then begin Result := True; exit; end;
          if (Find.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
            if HasLinks(AddBackslash(Folder) + Find.Name, Count) then begin Result := True; exit; end;
        end;
      until not FindNext(Find);
    finally FindClose(Find); end;
  end;
end;

function ValidateDestination: String;
var Folder, Parent: String; Existing: AnsiString; Find: TFindRec; Count: Integer; Nonempty: Boolean;
begin
  Result := ''; Folder := ExpandFileName(ExpandConstant('{app}')); Parent := Folder;
  if Copy(Folder, 1, 2) = '\\' then begin Result := 'Choose a local writable folder, not a network or extended-length path.'; exit; end;
  while Length(Parent) > 3 do begin
    if DirExists(Parent) then
      if (GetFileAttributes(Parent) and $400) <> 0 then begin Result := 'Choose a local folder without directory links.'; exit; end;
    Parent := ExtractFileDir(Parent);
  end;
  if not DirExists(Folder) then exit;
  Nonempty := False;
  if FindFirst(AddBackslash(Folder) + '*', Find) then begin
    try repeat if (Find.Name <> '.') and (Find.Name <> '..') then Nonempty := True; until not FindNext(Find);
    finally FindClose(Find); end;
  end;
  if Nonempty then begin
    if not LoadStringFromFile(Folder + '\data\installation.json', Existing) then Existing := '';
    if Trim(Existing) <> Marker then begin Result := 'Choose an empty folder. This folder is not owned by the Localserve installer.'; exit; end;
    Count := 0;
    if HasLinks(Folder, Count) then Result := 'This installation contains directory links or too many entries. Setup cannot safely replace it.';
  end;
end;

function AcquireMaintenance(UseTempTray: Boolean): String;
var TrayFile, Identity: String; Code, I: Integer; Output: TExecOutput;
begin
  Result := ''; if Maintenance <> 0 then exit;
  if UseTempTray then begin ExtractTemporaryFile('LocalserveTray.exe'); TrayFile := ExpandConstant('{tmp}\LocalserveTray.exe'); end
  else TrayFile := ExpandConstant('{app}\tray\LocalserveTray.exe');
  if not ExecAndCaptureOutput(TrayFile, '--identity "' + ExpandConstant('{app}') + '"', '', SW_HIDE, ewWaitUntilTerminated, Code, Output) then begin Result := 'Could not check the installation identity.'; exit; end;
  if (Code <> 0) or Output.Error or (GetArrayLength(Output.StdOut) <> 1) then begin Result := 'Could not check the installation identity.'; exit; end;
  Identity := Trim(Output.StdOut[0]);
  if Length(Identity) <> 24 then begin Result := 'Invalid installation identity.'; exit; end;
  for I := 1 to Length(Identity) do if Pos(Identity[I], '0123456789abcdef') = 0 then begin Result := 'Invalid installation identity.'; exit; end;
  Maintenance := CreateMutex(0, False, 'Local\LocalserveMaintenance-' + Identity);
  if Maintenance = 0 then begin Result := 'Could not reserve this installation for maintenance.'; exit; end;
  if FileExists(ExpandConstant('{app}\tray\LocalserveTray.exe')) then begin
    if not Exec(ExpandConstant('{app}\tray\LocalserveTray.exe'), '--stop-and-exit', '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
    if Code <> 0 then begin Result := 'Close this Localserve installation normally before continuing. No process was force-stopped.'; ReleaseMaintenance; end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := ValidateDestination; if Result <> '' then exit;
  if not IsDotNetInstalled(net48, 0) then begin Result := 'Localserve requires Microsoft .NET Framework 4.8 or later. Install it and run Setup again.'; exit; end;
  Result := AcquireMaintenance(True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer;
begin
  if CurStep = ssPostInstall then begin
    ForceDirectories(ExpandConstant('{app}\data'));
    if not SaveStringToFile(ExpandConstant('{app}\data\installation.json'), Marker, False) then RaiseException('Could not record the installation.');
    if not Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\tools\initialize-settings.mjs') + '"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
    if Code <> 0 then RaiseException('Could not initialize Localserve settings. Your existing settings were not replaced.');
    ReleaseMaintenance;
  end;
end;

procedure DeinitializeSetup;
begin ReleaseMaintenance; end;

function InitializeUninstall: Boolean;
var Error: String;
begin
  Error := ValidateDestination; Result := Error = '';
  if not Result then SuppressibleMsgBox(Error, mbError, MB_OK, IDOK);
  RemovePrivate := ExpandConstant('{param:DELETEPRIVATE|0}') = '1';
  if Result and not UninstallSilent then
    RemovePrivate := MsgBox('Also permanently delete Localserve settings, saved Tasks, Vistas, Cards, Controls, credentials and logs? Choose No to keep them.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Error: String; Code: Integer; Find: TFindRec;
begin
  if CurUninstallStep = usUninstall then begin
    Error := AcquireMaintenance(False); if Error <> '' then RaiseException(Error);
    if not Exec(ExpandConstant('{app}\tray\LocalserveTray.exe'), '--disable-startup', '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
    if Code <> 0 then RaiseException('Could not remove this installation''s Windows startup entry.');
    if RemovePrivate then begin
      if ValidateDestination <> '' then RaiseException('Private data deletion was cancelled because the destination changed.');
      DeleteFile(ExpandConstant('{app}\config.json'));
      DeleteFile(ExpandConstant('{app}\tray\settings.json'));
      if FindFirst(ExpandConstant('{app}\plugins\*'), Find) then begin
        try
          repeat
            if (Find.Name <> '.') and (Find.Name <> '..') and ((Find.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) then
              DelTree(ExpandConstant('{app}\plugins\') + Find.Name + '\data', True, True, True);
          until not FindNext(Find);
        finally FindClose(Find); end;
      end;
      DelTree(ExpandConstant('{app}\data'), True, True, True);
    end;
  end;
end;

procedure DeinitializeUninstall;
begin ReleaseMaintenance; end;
