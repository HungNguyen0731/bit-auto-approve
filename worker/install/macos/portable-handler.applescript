on open location pairURL
  set launcherPath to (POSIX path of (path to me)) & "Contents/MacOS/WorkerLauncher"
  do shell script (quoted form of launcherPath) & " " & (quoted form of pairURL)
end open location
