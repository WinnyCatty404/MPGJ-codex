using System;
using System.Diagnostics;
using System.IO;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string appRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string controlScript = Path.Combine(appRoot, "bb-control.ps1");
            if (!File.Exists(controlScript))
            {
                return 2;
            }

            string powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            var startInfo = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \""
                    + controlScript + "\" -AppRoot \"" + appRoot + "\"",
                WorkingDirectory = appRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(startInfo);
            return 0;
        }
        catch
        {
            return 1;
        }
    }
}
