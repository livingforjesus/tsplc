"""Exercise the installer's extraction against the pinned MSI package inventory."""
import csv
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


installer = (Path(__file__).parent.parent / 'docker' / 'install' / 'install.sh').read_text()
marker = 'python3 - "$msi" "$work/setup-files.tsv" "$WINEPREFIX/drive_c" <<\'PY\'\n'
extractor = installer.split(marker, 1)[1].split('\nPY\n', 1)[0]

# These identities are from the SP22 Patch 3 MSI's ISSetupFile table.
packages = {
    'CODESYS Scripting 4.2.0.0': 'scripting',
    'CODESYS RISC Front End 4.0.2.0': 'risc',
    'CODESYS Code Generator ARM64 4.0.1.0': 'arm64',
    'CODESYS Library Dependency Inspection 1.1.0.0': 'library-inspection',
    'CODESYS Base Libraries 4.0.1.0': 'base-libraries',
    'CODESYS Visualization Support 4.7.0.0': 'visualization-support',
    'CODESYS Math Libraries 4.0.0.0': 'math-libraries',
    'CODESYS Recipes 4.7.0.0': 'recipes',
    'CODESYS Trace 4.4.0.0': 'trace',
    'CODESYS Communication 4.8.0.0': 'communication',
    'CODESYS Visualization 4.10.0.0': 'visualization',
}


class InstallerPackageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / 'output'
        self.output.mkdir()
        self.table = self.root / 'setup-files.tsv'
        self.rows = []
        for name, output in packages.items():
            stream = 'ISSetupFile.' + output
            self.rows.append({'FileName': 'Packages\\' + name + '.package', 'Stream': stream})
            with zipfile.ZipFile(self.root / stream, 'w') as archive:
                archive.writestr('package.manifest', '<Package/>')
        tool = self.root / 'msiinfo'
        tool.write_text(
            '#!' + sys.executable + '\n'
            'import pathlib, sys\n'
            'sys.stdout.buffer.write((pathlib.Path(sys.argv[2]) / sys.argv[3]).read_bytes())\n'
        )
        tool.chmod(0o755)

    def extract(self):
        with self.table.open('w', newline='') as output:
            writer = csv.DictWriter(output, ['FileName', 'Stream'], delimiter='\t')
            writer.writeheader()
            writer.writerows(self.rows)
        return subprocess.run(
            [sys.executable, '-c', extractor, str(self.root), str(self.table), str(self.output)],
            env={**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH']},
            capture_output=True,
            text=True,
        )

    def test_extracts_complete_symbol_publishing_dependencies_in_installable_order(self):
        result = self.extract()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            {path.stem for path in self.output.iterdir()},
            set(packages.values()),
        )
        # Component selection must preserve the original vendor archive bytes.
        for name in packages.values():
            self.assertEqual(
                (self.output / (name + '.package')).read_bytes(),
                (self.root / ('ISSetupFile.' + name)).read_bytes(),
            )
        order = re.search(r'for package in (.+); do', installer).group(1).split()
        self.assertEqual(set(order), set(packages.values()))
        self.assertLess(order.index('library-inspection'), order.index('math-libraries'))
        for prerequisite in (
            'visualization-support', 'trace', 'recipes', 'communication',
            'base-libraries', 'math-libraries',
        ):
            self.assertLess(order.index(prerequisite), order.index('visualization'))

    def test_visualization_uses_official_headless_components(self):
        self.assertIn('set "packageComponents="', installer)
        self.assertIn(
            'if "%~1"=="visualization" set "packageComponents=--components=2;3;4"',
            installer,
        )
        self.assertIn('"C:\\%~1.package" %packageComponents%', installer)

    def test_rejects_missing_visualization_prerequisite_before_package_installation(self):
        self.rows = [row for row in self.rows if row['Stream'] != 'ISSetupFile.trace']
        result = self.extract()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing bundled packages: Packages\\CODESYS Trace 4.4.0.0.package', result.stderr)

    def test_rejects_corrupt_embedded_package_data(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as package:
            package.writestr('package.manifest', 'unchanged manifest')
        corrupted = archive.getvalue().replace(b'unchanged manifest', b'corrupted manifest', 1)
        (self.root / 'ISSetupFile.visualization').write_bytes(corrupted)
        result = self.extract()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Corrupt package: Packages\\CODESYS Visualization 4.10.0.0.package', result.stderr)

    def test_generated_package_command_captures_windows_status_before_printing(self):
        prefix = self.output / 'drive_c'
        prefix.mkdir()
        start = installer.index("printf '%s\\r\\n' '@echo off'")
        end = installer.index('# Symbol publishing', start)
        result = subprocess.run(
            ['sh', '-eu', '-c', installer[start:end]],
            env={**os.environ, 'WINEPREFIX': str(self.output)},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        command = (prefix / 'install-package.cmd').read_bytes().decode().splitlines()
        call = next(index for index, line in enumerate(command) if line.startswith('PackageManagerCLI.exe '))
        self.assertEqual(command[call + 1], 'set "packageStatus=%errorlevel%"')
        self.assertEqual(command[call + 2],
            'if not "%packageStatus%"=="0" echo PackageManagerCLI Windows exit status: %packageStatus%')
        self.assertEqual(command[call + 3], 'exit /b %packageStatus%')

    def run_package_loop(self, failed_package, log_bytes='Finalizing the original package'.encode('utf-16'), failed_logger=False):
        prefix = self.output / 'drive_c'
        prefix.mkdir()
        log = prefix / 'package-install.log'
        if log_bytes is None:
            log.mkdir()  # A path that exists but cannot be read as a log file.
        else:
            log.write_bytes(log_bytes)
        calls = self.root / 'calls.jsonl'
        tool = self.root / 'timeout'
        tool.write_text(
            '#!' + sys.executable + '\n'
            'import json, os, pathlib, shlex, sys\n'
            'command = sys.argv[sys.argv.index("-c") + 1]\n'
            'package = shlex.split(command)[-1]\n'
            'debug = os.environ.get("WINEDEBUG", "")\n'
            'with pathlib.Path(os.environ["INSTALLER_TEST_CALLS"]).open("a") as out:\n'
            ' out.write(json.dumps({"package": package, "debug": debug}) + "\\n")\n'
            'if package == os.environ["INSTALLER_TEST_FAILURE"]:\n'
            ' if "err+seh" in debug: print("fixture err:seh:NtRaiseException Unhandled exception code c0000005", file=sys.stderr)\n'
            ' sys.exit(5)\n'
        )
        tool.chmod(0o755)
        if failed_logger:
            logger = self.root / 'python3'
            logger.write_text('#!/bin/sh\necho "Fixture log helper failed" >&2\nexit 19\n')
            logger.chmod(0o755)
        start = installer.index('for package in ')
        end = installer.index('\ndone\n', start) + len('\ndone\n')
        # Exercise the real shell failure/logging loop with a controlled process result.
        script = installer[:installer.index('work=/tmp/codesys-setup')] + installer[start:end]
        result = subprocess.run(
            ['sh', '-c', script],
            env={**os.environ, 'WINEPREFIX': str(self.output), 'WINEDEBUG': '-all',
                'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                'INSTALLER_TEST_CALLS': str(calls), 'INSTALLER_TEST_FAILURE': failed_package},
            capture_output=True, text=True,
        )
        return result, [json.loads(line) for line in calls.read_text().splitlines()]

    def test_package_failure_keeps_exit_status_and_fatal_diagnostics_without_continuing(self):
        result, calls = self.run_package_loop('visualization-support')
        self.assertEqual(result.returncode, 5)
        self.assertIn('Unhandled exception code c0000005', result.stderr)
        self.assertIn('Package visualization-support installer exited with status 5', result.stdout)
        self.assertIn('Finalizing the original package', result.stdout)
        self.assertEqual(calls[-1]['package'], 'visualization-support')
        self.assertNotIn('Installed visualization-support package', result.stdout)
        self.assertTrue(all(call['debug'] == '-all,err+seh' for call in calls))

    def test_successful_package_loop_remains_successful(self):
        result, calls = self.run_package_loop('')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({call['package'] for call in calls}, set(packages.values()))
        self.assertEqual(result.stdout.count('Installed '), len(packages))
        self.assertEqual(result.stderr, '')

    def test_truncated_utf16_log_never_masks_package_failure(self):
        result, calls = self.run_package_loop('visualization-support', b'\xff\xfe\x00')
        self.assertEqual(result.returncode, 5)
        self.assertIn('Package visualization-support installer exited with status 5', result.stdout)
        self.assertNotIn('UnicodeDecodeError', result.stderr)
        self.assertEqual(calls[-1]['package'], 'visualization-support')

    def test_unreadable_package_log_never_masks_package_failure(self):
        result, calls = self.run_package_loop('visualization-support', None)
        self.assertEqual(result.returncode, 5)
        self.assertIn('Could not read package install log', result.stderr)
        self.assertEqual(calls[-1]['package'], 'visualization-support')

    def test_failed_log_helper_never_masks_package_failure(self):
        result, calls = self.run_package_loop('visualization-support', failed_logger=True)
        self.assertEqual(result.returncode, 5)
        self.assertIn('Fixture log helper failed', result.stderr)
        self.assertEqual(calls[-1]['package'], 'visualization-support')


if __name__ == '__main__':
    unittest.main()
