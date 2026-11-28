; HeldixClient – eigene Schritte im Windows-Installer (electron-builder, "nsis.include" in package.json).
;
; Einladung im Download: Wer den Launcher über eine Einladung lädt (/einladung#<code> auf der Webseite), bekommt vom
; Heldix-Dienst denselben Installer unter dem Namen HeldixClient-Setup-<version>-einladung-<code>.exe
; (?einladung=<code>, siehe docs/dienst.md). Beim Installieren liest dieser Teil den Code aus dem eigenen Dateinamen
; ($EXEFILE), lässt nur genau 10 Zeichen aus dem Code-Alphabet zu (a-z und 2-9 ohne i, l, o, 0, 1) und schreibt ihn
; nach %APPDATA%\.heldixclient\download-invite.txt – das ist der Datenordner des Launchers (core/paths.ts, er nimmt
; ebenfalls die Umgebungsvariable APPDATA). Der Launcher liest die Datei beim nächsten Start einmal, prüft sie und
; löscht sie (core/invites.ts, takeDownloadInvite), dann öffnet sich der Einladungsdialog.
;
; Kein Code im Namen, ein stilles Update (--updated, der Name des Update-Installers hat nie einen Code) oder irgendein
; Fehler beim Schreiben: nichts tun – die Installation läuft immer normal weiter.
;
; Nur Register, keine eigenen Variablen oder Funktionen: electron-builder baut mit -WX (Warnungen sind Fehler), und
; das Include gilt auch für den Bau des Deinstallers, der diese Schritte nicht benutzt.
;
; Seiten im Heldix-Design (ab 0.13.8): Die Bilder (build/installerSidebar.bmp, build/uninstallerSidebar.bmp,
; build/installerHeader.bmp) erzeugt scripts/render-installer.mjs (npm run installer-art), die Sprache ist Deutsch
; (installerLanguages in package.json). Die Texte unten duzen wie der Launcher – die deutschen Standardtexte von NSIS
; siezen. Sie stehen als Defines vor MUI2.nsh (electron-builder bindet diese Datei vor installer.nsi ein) und gelten für
; die nächste passende MUI-Seite, deshalb getrennt nach Installer und Deinstaller (BUILD_UNINSTALLER). Die Willkommen-
; Seite gibt es bei electron-builder nur über das Makro customWelcomePage; bei einem Update (--updated, still) wird
; sie wie die übrigen Seiten übersprungen (skipPageIfUpdated). Am Installationsordner ändert sich nichts.

!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_TITLE "HeldixClient ist bereit"
  !define MUI_FINISHPAGE_TEXT "HeldixClient wurde installiert. Beim ersten Start führt dich ein kurzer Assistent durch Konto und Addons.$\r$\n$\r$\nKlicke auf „Fertigstellen“, um den Installer zu schließen."
  ; angehakt (Standard von electron-builder: runAfterFinish)
  !define MUI_FINISHPAGE_RUN_TEXT "HeldixClient starten"
!else
  !define MUI_WELCOMEPAGE_TITLE "HeldixClient deinstallieren"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent entfernt HeldixClient von deinem PC.$\r$\n$\r$\nDeine Welten, Instanzen und Einstellungen im Ordner %APPDATA%\.heldixclient bleiben erhalten – installierst du HeldixClient wieder, ist alles noch da.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
  !define MUI_FINISHPAGE_TITLE "HeldixClient wurde entfernt"
  !define MUI_FINISHPAGE_TEXT "Deine Welten, Instanzen und Einstellungen liegen weiter in %APPDATA%\.heldixclient.$\r$\n$\r$\nBis bald!"
!endif

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Willkommen bei HeldixClient"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert HeldixClient – den Minecraft-Launcher mit eigenem Client, Addons und Freunden.$\r$\n$\r$\nDeine Welten, Instanzen und Einstellungen liegen in einem eigenen Ordner und bleiben bei Updates erhalten.$\r$\n$\r$\nKlicke auf „Weiter“, um fortzufahren."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Autostart (Einstellungen → Allgemein → „Mit Windows starten“, ab 0.14.0): app.setLoginItemSettings schreibt den Wert
; „HeldixClient“ unter HKCU\Software\Microsoft\Windows\CurrentVersion\Run (core/background.ts, LOGIN_ITEM_NAME).
; Beim Deinstallieren entfernen – nicht bei einem Update (--updated), da trägt der neue Launcher ihn beim Start neu ein.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HeldixClient"
  ${endIf}
!macroend

!macro customInstall
  !insertmacro heldixInviteFromFileName
!macroend

!macro heldixInviteFromFileName
  ${ifNot} ${isUpdated}
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    ; „-einladung-“ im Dateinamen suchen ($0 = Position)
    StrCpy $0 0
    heldix_invite_search:
      StrCpy $1 $EXEFILE 11 $0
      StrCmp $1 "" heldix_invite_done
      StrCmpS $1 "-einladung-" heldix_invite_found
      IntOp $0 $0 + 1
      Goto heldix_invite_search
    heldix_invite_found:
      ; die 10 Zeichen danach sind der Code ($2)
      IntOp $0 $0 + 11
      StrCpy $2 $EXEFILE 10 $0
      StrLen $1 $2
      IntCmp $1 10 0 heldix_invite_done heldix_invite_done
      ; danach endet der Name („.exe“) oder es folgt ein Zusatz des Browsers („ (1).exe“, „(1).exe“)
      IntOp $3 $0 + 10
      StrCpy $1 $EXEFILE 1 $3
      StrCmp $1 "." heldix_invite_check
      StrCmp $1 " " heldix_invite_check
      StrCmp $1 "(" heldix_invite_check heldix_invite_done
    heldix_invite_check:
      ; jedes Zeichen muss im Code-Alphabet stehen (StrCmpS: Groß- und Kleinschreibung zählt)
      StrCpy $3 0
    heldix_invite_char:
      IntCmp $3 10 heldix_invite_write
      StrCpy $1 $2 1 $3
      StrCpy $4 0
    heldix_invite_alphabet:
      StrCpy $5 "abcdefghjkmnpqrstuvwxyz23456789" 1 $4
      StrCmp $5 "" heldix_invite_done
      StrCmpS $1 $5 heldix_invite_next
      IntOp $4 $4 + 1
      Goto heldix_invite_alphabet
    heldix_invite_next:
      IntOp $3 $3 + 1
      Goto heldix_invite_char
    heldix_invite_write:
      ; Datenordner des Launchers wie in core/paths.ts: %APPDATA%\.heldixclient
      ReadEnvStr $1 APPDATA
      StrCmp $1 "" heldix_invite_done
      CreateDirectory "$1\.heldixclient"
      ClearErrors
      FileOpen $4 "$1\.heldixclient\download-invite.txt" w
      IfErrors heldix_invite_done
      FileWrite $4 $2
      FileClose $4
    heldix_invite_done:
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${endIf}
!macroend
