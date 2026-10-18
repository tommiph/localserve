using System;
using System.Text;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// One bounded credential transform, then normal exit. Credentials use stdin;
// neither arguments nor diagnostics carry account data. CurrentUser DPAPI and
// application-specific entropy prevent use by a different Windows account.
public static class Vault
{
    public static int Main()
    {
        try
        {
            string line = Console.ReadLine();
            if (line == null || line.Length > 60000) return 2;
            var json = new JavaScriptSerializer { MaxJsonLength = 60000 };
            var input = json.Deserialize<Dictionary<string, string>>(line);
            if (input.Count != 2 || !input.ContainsKey("operation") || !input.ContainsKey("value")) return 2;
            byte[] value = Convert.FromBase64String(input["value"]);
            if (value.Length > 32768) return 2;
            byte[] entropy = Encoding.UTF8.GetBytes("Localserve.OculusGo.v1");
            byte[] output;
            if (input["operation"] == "protect") output = ProtectedData.Protect(value, entropy, DataProtectionScope.CurrentUser);
            else if (input["operation"] == "unprotect") output = ProtectedData.Unprotect(value, entropy, DataProtectionScope.CurrentUser);
            else return 2;
            Console.Write(Convert.ToBase64String(output));
            return 0;
        }
        catch { return 2; }
    }
}

