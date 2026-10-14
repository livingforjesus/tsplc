#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

/* Adapt the legacy package-manager protocol to the bundled metadata helper.
   APPDOMAIN_MANAGER_* belongs to the old reflection helper, not helper 2. */
int wmain(int argc, wchar_t **argv) {
    if (argc == 2 && !wcscmp(argv[1], L"-getAppDomainManagerAssembly")) {
        fputs("Utilities, Version=3.5.22.30, Culture=neutral, PublicKeyToken=83380e73b2486719", stdout);
        return 0;
    }
    if (argc == 2 && !wcscmp(argv[1], L"-getAppDomainManagerType")) {
        fputs("_3S.CoDeSys.Utilities.InstallerAppDomainManager", stdout);
        return 0;
    }
    wchar_t path[32768];
    DWORD length = GetModuleFileNameW(NULL, path, 32768);
    if (!length || length >= 32768) return 1;
    wchar_t *name = wcsrchr(path, L'\\');
    if (!name || name - path + 27 >= 32768) return 1;
    wcscpy(name + 1, L"CoreInstallerSupport2.exe");
    const wchar_t *args = GetCommandLineW();
    if (*args == L'"') { args++; while (*args && *args != L'"') args++; if (*args) args++; }
    else while (*args && *args != L' ' && *args != L'\t') args++;
    size_t size = wcslen(path) + wcslen(args) + 4;
    wchar_t *command = calloc(size, sizeof(wchar_t));
    if (!command) return 1;
    swprintf(command, size, L"\"%ls\"%ls", path, args);
    SetEnvironmentVariableW(L"APPDOMAIN_MANAGER_ASM", NULL);
    SetEnvironmentVariableW(L"APPDOMAIN_MANAGER_TYPE", NULL);
    STARTUPINFOW startup = { .cb = sizeof(startup) };
    PROCESS_INFORMATION process;
    if (!CreateProcessW(path, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process)) {
        fwprintf(stderr, L"Cannot start CODESYS metadata helper: Windows error %lu\n", GetLastError());
        free(command);
        return 1;
    }
    free(command);
    CloseHandle(process.hThread);
    DWORD result = 1;
    if (WaitForSingleObject(process.hProcess, INFINITE) == WAIT_OBJECT_0)
        GetExitCodeProcess(process.hProcess, &result);
    CloseHandle(process.hProcess);
    return (int)result;
}
