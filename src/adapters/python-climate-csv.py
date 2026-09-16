import builtins
import os
import runpy
import shutil
import sys
import tempfile


script_path, csv_path = sys.argv[1:3]
city = sys.argv[3] if len(sys.argv) > 3 else ""

with tempfile.TemporaryDirectory(prefix="repo-gui-climate-") as working_directory:
    shutil.copy2(csv_path, os.path.join(working_directory, os.path.basename(csv_path)))
    previous_directory = os.getcwd()
    previous_input = builtins.input
    try:
        os.chdir(working_directory)
        selection = "1" + (f", {city}" if city else "")
        builtins.input = lambda prompt="": (print(prompt, end=""), selection)[1]
        runpy.run_path(script_path, run_name="__repo_gui__")
        print("\nClimate data loaded successfully. The repository's analysis functions are ready.")
    finally:
        builtins.input = previous_input
        os.chdir(previous_directory)
