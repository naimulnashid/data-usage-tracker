# App logos

No logos ship with this project: they are other companies' trademarks, and the
set on any one machine is a list of what that person has installed. Without
them every app is shown with a colour swatch, which works fine.

To add your own, make one folder per device, named by the device's URL slug:

```
public/apps_logo/my-pc/          # the laptop: /windows/my-pc
public/apps_logo/pixel-8/        # a phone:    /android/pixel-8
```

Then drop image files in, named after the app as the dashboard shows it:
`Brave.svg`, `Microsoft Edge.png`, `qBittorrent.svg`. Matching ignores case, and
`.svg`, `.png`, `.jpg`, `.webp`, `.gif` and `.avif` all work. No restart is
needed: the folder is read on every request.

- A device sees only its own folder, so an app on two devices needs the file in
  both.
- A file at this level, outside any device folder, is never served.
- Names that cannot match a file (a shared Windows mark, for example) are
  mapped in `ICON_ALIASES` in `src/lib/app-icons.ts`.
- A logo that is dark on dark can be given a light plate by adding its file
  name stem to `PLATE_STEMS` in the same file.
