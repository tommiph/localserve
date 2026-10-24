package local.localserve.relay;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.text.InputType;
import android.widget.*;
import org.json.JSONObject;

/** Private, explicit cloud transport selection. A profile never starts Sensors
 * or grants Android permissions and is never supplied by a remote web page. */
public final class RelaySettings {
    public static void show(Activity activity,SharedPreferences preferences,String deviceId,Runnable saved) {
        LinearLayout form=new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);int gap=Math.round(20*activity.getResources().getDisplayMetrics().density);form.setPadding(gap,gap,gap,gap);
        TextView help=new TextView(activity);help.setText("LAN is the default. Relay sends your selected reports or published shortcuts through your Google Apps Script project. Paste the private client profile exported by Localserve. Keep it secret."
            +(deviceId.isEmpty()?"":"\n\nSensor device ID:\n"+deviceId));help.setTextIsSelectable(true);form.addView(help);
        Spinner mode=new Spinner(activity);mode.setAdapter(new ArrayAdapter<String>(activity,android.R.layout.simple_spinner_dropdown_item,new String[]{"Local network","Google Apps Script relay"}));mode.setSelection(preferences.getBoolean("relayMode",false)?1:0);form.addView(mode);
        TextView label=new TextView(activity);label.setText("Private relay profile (JSON)");label.setPadding(0,gap,0,0);form.addView(label);
        EditText profile=new EditText(activity);profile.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|InputType.TYPE_TEXT_FLAG_MULTI_LINE|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);profile.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO);profile.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4096)});profile.setMinLines(5);profile.setMaxLines(8);profile.setText(preferences.getString("relayProfile",""));form.addView(profile);
        ScrollView scroll=new ScrollView(activity);scroll.addView(form);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("Relay connection").setView(scroll).setNegativeButton("Cancel",null).setPositiveButton("Save",null).create();
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view->{
            try {
                String value=profile.getText().toString().trim();if(mode.getSelectedItemPosition()==1){new RelayClient(value).close();JSONObject data=new JSONObject(value);
                    if(!deviceId.isEmpty()&&!deviceId.equals(data.optString("deviceId")))throw new Exception("This profile must contain this phone's Sensor device ID.");}
                preferences.edit().putBoolean("relayMode",mode.getSelectedItemPosition()==1).putString("relayProfile",value).apply();dialog.dismiss();saved.run();
            }catch(Exception error){profile.setError("Paste a valid profile for this phone from Localserve. The deployment must be HTTPS and end in /exec.");}
        }));dialog.show();
    }
    private RelaySettings(){}
}
