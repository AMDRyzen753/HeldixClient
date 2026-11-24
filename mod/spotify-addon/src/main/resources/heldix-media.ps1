# Heldix-Spotify-Addon: Brücke zur Windows-Mediensteuerung (System Media Transport Controls).
# Liest Titel, Künstler, Album, Cover und Fortschritt der laufenden Wiedergabe (Spotify oder anderer Player)
# und führt Befehle aus. Kein Spotify-Konto, kein Premium, kein API-Schlüssel nötig.
#
# Ausgabe (eine Zeile pro Sekunde, Tab-getrennt):
#   STATE <tab> App <tab> Status <tab> Titel <tab> Künstler <tab> Album <tab> PositionMs <tab> DauerMs <tab> StandMs <tab> Cover-Datei
#   NONE                      – nichts spielt / Player nicht offen
#   ERROR <tab> Meldung
# Eingabe (eine Zeile pro Befehl): playpause | next | previous | mode spotify | mode any | quit
param(
	[string]$CoverDir = (Join-Path $env:TEMP 'heldix-media'),
	[string]$Mode = 'spotify'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$type) {
	$task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($operation))
	$null = $task.Wait(5000)
	return $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
# Der WinRT-Stream ist für PowerShell nur ein __ComObject: Umwandlung in einen .NET-Stream per Reflection
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

New-Item -ItemType Directory -Force -Path $CoverDir | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Clean([string]$text) {
	if ($null -eq $text) { return '' }
	return ($text -replace "[`t`r`n]", ' ').Trim()
}

function Find-Session {
	$sessions = @($manager.GetSessions())
	$spotify = $sessions | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
	if ($spotify) { return $spotify }
	if ($Mode -eq 'any') { return $manager.GetCurrentSession() }
	return $null
}

function App-Name([string]$id) {
	if ($id -like '*Spotify*') { return 'Spotify' }
	$name = ($id -split '[\\/!]')[-1] -replace '\.exe$', ''
	if ($name.Length -gt 0) { return $name.Substring(0, 1).ToUpper() + $name.Substring(1) }
	return 'Player'
}

# Cover als 128×128-PNG speichern. Der Dateiname kommt aus dem Bildinhalt: Spotify meldet den neuen Titel oft
# kurz bevor das neue Cover bereitsteht, deshalb wird pro Titel dreimal nachgesehen (sofort, nach 2 s, nach 6 s).
$coverKey = ''
$coverFile = ''
$coverTries = 0
$coverNext = [DateTime]::MinValue
function Save-Cover($properties) {
	$key = "$($properties.Title)|$($properties.Artist)|$($properties.AlbumTitle)"
	if ($key -ne $script:coverKey) {
		$script:coverKey = $key
		$script:coverFile = ''
		$script:coverTries = 0
		$script:coverNext = [DateTime]::MinValue
	}
	if ($script:coverTries -ge 3 -or [DateTime]::Now -lt $script:coverNext) { return $script:coverFile }
	$script:coverTries++
	$script:coverNext = [DateTime]::Now.AddSeconds(2 * $script:coverTries)
	if ($null -eq $properties.Thumbnail) { return $script:coverFile }
	$memory = $null
	try {
		$stream = Await ($properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
		$net = $asStreamForRead.Invoke($null, @($stream))
		$memory = New-Object System.IO.MemoryStream
		$net.CopyTo($memory)
		$net.Dispose()
		if ($memory.Length -eq 0) { return $script:coverFile }
		$hash = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash($memory.ToArray())).Replace('-', '').Substring(0, 16).ToLower()
		$file = Join-Path $CoverDir "cover-$hash.png"
		if (-not (Test-Path $file)) {
			$memory.Position = 0
			$image = [System.Drawing.Image]::FromStream($memory)
			# Videos im Browser liefern breite Vorschaubilder: mittiges Quadrat nehmen
			$side = [Math]::Min($image.Width, $image.Height)
			$sourceX = [int](($image.Width - $side) / 2)
			$sourceY = [int](($image.Height - $side) / 2)
			$size = 128
			$square = New-Object System.Drawing.Bitmap $size, $size
			$scaler = [System.Drawing.Graphics]::FromImage($square)
			$scaler.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
			$scaler.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
			$attributes = New-Object System.Drawing.Imaging.ImageAttributes
			$attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
			$scaler.DrawImage($image, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), $sourceX, $sourceY, $side, $side, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
			$scaler.Dispose()
			# abgerundete Ecken (kantengeglättet), passend zu den Heldix-Flächen
			$bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
			$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
			$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
			$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
			$d = 40
			$path = New-Object System.Drawing.Drawing2D.GraphicsPath
			$path.AddArc(0, 0, $d, $d, 180, 90)
			$path.AddArc($size - $d, 0, $d, $d, 270, 90)
			$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
			$path.AddArc(0, $size - $d, $d, $d, 90, 90)
			$path.CloseFigure()
			$brush = New-Object System.Drawing.TextureBrush $square
			$graphics.FillPath($brush, $path)
			$temp = "$file.tmp"
			$bitmap.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
			$brush.Dispose(); $path.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $square.Dispose(); $image.Dispose()
			Move-Item -Force $temp $file
			# alte Cover aufräumen (höchstens 30 behalten)
			Get-ChildItem $CoverDir -Filter 'cover-*.png' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -ErrorAction SilentlyContinue
		}
		$script:coverFile = $file
	} catch {
	} finally {
		if ($memory) { $memory.Dispose() }
	}
	return $script:coverFile
}

function Write-State {
	$session = Find-Session
	if ($null -eq $session) {
		[Console]::Out.WriteLine('NONE')
		return
	}
	$properties = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
	$playback = $session.GetPlaybackInfo()
	$timeline = $session.GetTimelineProperties()
	$title = Clean $properties.Title
	if ($title -eq '') {
		[Console]::Out.WriteLine('NONE')
		return
	}
	$cover = Save-Cover $properties
	$fields = @(
		'STATE',
		(App-Name $session.SourceAppUserModelId),
		[string]$playback.PlaybackStatus,
		$title,
		(Clean $properties.Artist),
		(Clean $properties.AlbumTitle),
		[long]$timeline.Position.TotalMilliseconds,
		[long]$timeline.EndTime.TotalMilliseconds,
		[long]$timeline.LastUpdatedTime.ToUnixTimeMilliseconds(),
		$cover
	)
	[Console]::Out.WriteLine(($fields -join "`t"))
}

function Run-Command([string]$command) {
	$session = Find-Session
	if ($null -eq $session) { return }
	switch ($command) {
		'playpause' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
		'next' { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
		'previous' { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
	}
}

# Befehle im Hintergrund lesen (Console.In würde blockieren); endet die Eingabe, ist das Spiel beendet
$stdin = [Console]::OpenStandardInput()
$buffer = New-Object byte[] 1024
$pendingRead = $stdin.ReadAsync($buffer, 0, $buffer.Length)
$inputText = ''
$lastState = [DateTime]::MinValue
$running = $true
while ($running) {
	try {
		if ($pendingRead.IsCompleted) {
			$count = $pendingRead.Result
			if ($count -le 0) { break }
			$inputText += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $count)
			while (($index = $inputText.IndexOf("`n")) -ge 0) {
				$line = $inputText.Substring(0, $index).Trim()
				$inputText = $inputText.Substring($index + 1)
				if ($line -eq 'quit') { $running = $false; break }
				if ($line -like 'mode *') {
					$script:Mode = $line.Substring(5)
				} elseif ($line -ne '') {
					Run-Command $line
				}
				$lastState = [DateTime]::MinValue
			}
			if (-not $running) { break }
			$pendingRead = $stdin.ReadAsync($buffer, 0, $buffer.Length)
		}
		if (([DateTime]::Now - $lastState).TotalMilliseconds -ge 1000) {
			Write-State
			$lastState = [DateTime]::Now
		}
	} catch {
		[Console]::Out.WriteLine("ERROR`t" + (Clean $_.Exception.Message))
		$lastState = [DateTime]::Now
	}
	[Console]::Out.Flush()
	Start-Sleep -Milliseconds 120
}
