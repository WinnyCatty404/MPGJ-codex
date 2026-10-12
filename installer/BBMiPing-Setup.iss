; BMPBGS 安装脚本 (Inno Setup 6)
; 编译：运行 installer\build-installer.bat（需先安装 Inno Setup 6）
; 分发前请在本机把以下两项放入项目根目录（使安装包自包含，目标机无需安装 Node/PostgreSQL）：
;   1) 私有 Node.js：把 node.exe 及其依赖 DLL 放入 pgsql 同级目录的 node\（即 node\node.exe 存在）
;   2) 私有 PostgreSQL：把解压后的 bin/lib/share 放入根目录 pgsql\（即 pgsql\bin\pg_ctl.exe 存在）
#define MyAppName "BMPBGS"
#define MyAppVersion "1.2.1"

[Setup]
AppId={{BB-MIPING-TOOL-2026}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=BMPBGS团队
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=out
OutputBaseFilename=BMPBGS-Windows-x64-Setup
SetupIconFile=build\windows\app\bmpbgs.ico
UninstallDisplayIcon={app}\BMPBGS.exe
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
DisableProgramGroupPage=no
DisableDirPage=no
CloseApplications=no

[Languages]
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
; 打包 installer\staging\（由 build-installer.bat 先用 robocopy 生成干净暂存副本，
; 排除规则全部在 build-installer.bat 中，不在本文件里做 Excludes 匹配，避免语义坑）。
Source: "build\windows\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\BMPBGS"; Filename: "{app}\BMPBGS.exe"; WorkingDir: "{app}"; IconFilename: "{app}\bmpbgs.ico"
Name: "{userdesktop}\BMPBGS"; Filename: "{app}\BMPBGS.exe"; WorkingDir: "{app}"; IconFilename: "{app}\bmpbgs.ico"

[Run]
Filename: "{app}\BMPBGS.exe"; Description: "启动 BMPBGS"; Flags: nowait postinstall skipifsilent

; 自动清理旧版（req8 之前）遗留的独立「备份/恢复」快捷方式（仅在开始菜单程序组，名称无空格）。
; 正常升级时旧卸载会移除它们；此处兜底处理"手动删目录未卸载"导致的残留。
[InstallDelete]
Type: files; Name: "{group}\备份BMPBGS数据.lnk"
Type: files; Name: "{group}\恢复BMPBGS数据.lnk"
Type: files; Name: "{group}\BMPBGS控制台.lnk"
Type: files; Name: "{userdesktop}\BMPBGS控制台.lnk"

; 注意：有意不配置 [UninstallDelete] 清理 data / storage\projects / uploads。
; 这些目录属于用户运行期数据，卸载时保留可避免误删；如需彻底清理，请手动删除安装目录。

[Code]
var
  DataPage: TInputDirWizardPage;
  SuggestedDataDir: String;

procedure InitializeWizard;
begin
  DataPage := CreateInputDirPage(wpSelectDir, '数据存储位置',
    '选择数据库、项目文件和备份的存储位置',
    '默认在安装盘创建 BMPBGS-Data。请选择有写入权限的英文目录。' + #13#10 +
    '升级时请选择原数据目录；选择新的空目录会创建新的初始数据库。',
    False, '');
  DataPage.Add('数据存储目录：');
end;

procedure CurPageChanged(CurPageID: Integer);
var
  ExistingPath: AnsiString;
  NewSuggestion: String;
begin
  if CurPageID = DataPage.ID then
  begin
    NewSuggestion := ExtractFileDrive(WizardDirValue) + '\BMPBGS-Data';
    if LoadStringFromFile(AddBackslash(WizardDirValue) + 'bb-data-path.txt', ExistingPath) then
      NewSuggestion := Trim(String(ExistingPath));
    if (DataPage.Values[0] = '') or (DataPage.Values[0] = SuggestedDataDir) then
      DataPage.Values[0] := NewSuggestion;
    SuggestedDataDir := NewSuggestion;
    DataPage.Values[0] := ExpandConstant('{param:DATADIR|' + DataPage.Values[0] + '}');
  end;
end;

function IsAsciiPath(const Value: String): Boolean;
var
  I: Integer;
begin
  Result := True;
  for I := 1 to Length(Value) do
  begin
    if Ord(Value[I]) > 127 then
    begin
      Result := False;
      Exit;
    end;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  DataDir, Probe: String;
begin
  Result := True;
  if CurPageID = DataPage.ID then
  begin
    DataDir := RemoveBackslashUnlessRoot(Trim(DataPage.Values[0]));
    if (not IsAsciiPath(DataDir)) or (Length(DataDir) < 4) or
      (Copy(DataDir, 2, 2) <> ':\') then
    begin
      MsgBox('数据目录必须是本地磁盘的英文绝对路径，例如 D:\BMPBGS-Data。', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    Probe := AddBackslash(DataDir) + '.bmpbgs-write-' + GetDateTimeString('yyyymmddhhnnsszzz', '-', ':') + '.tmp';
    if not ForceDirectories(DataDir) then
      Result := False
    else if not SaveStringToFile(Probe, 'write-test', False) then
      Result := False
    else
      DeleteFile(Probe);
    if not Result then
      MsgBox('无法创建或写入此数据目录，请选择其他有写入权限的英文目录。', mbError, MB_OK)
    else
      DataPage.Values[0] := DataDir;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if not SaveStringToFile(ExpandConstant('{app}\bb-data-path.txt'), DataPage.Values[0], False) then
      RaiseException('无法保存数据存储位置配置。');
  end;
end;
