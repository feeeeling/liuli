param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
  [void][Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
  [void][Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
  [void][Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
  $taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Wait-Result($operation, $resultType) {
    $task = $taskMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult()
  }
  $file = Wait-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Wait-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Wait-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Wait-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { throw 'Windows 没有可用的 OCR 语言包。' }
  $result = Wait-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  # Chinese profile OCR can split Latin words. Use the English recognizer for
  # Latin-only regions when its language pack is already available.
  if ($result.Text -notmatch '[\u3400-\u9FFF]' -and $engine.RecognizerLanguage.LanguageTag -notlike 'en*') {
    $english = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
    if ($null -ne $english) { $result = Wait-Result ($english.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) }
  }
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  @{ text = ($lines -join "`n") } | ConvertTo-Json -Compress
} catch { @{ error = $_.Exception.Message } | ConvertTo-Json -Compress; exit 1 }
finally { if ($bitmap) { $bitmap.Dispose() }; if ($stream) { $stream.Dispose() } }
