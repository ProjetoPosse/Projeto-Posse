$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await-AsyncOperation {
    param(
        [Parameter(Mandatory = $true)]
        $Operation,

        [Parameter(Mandatory = $true)]
        [Type]$ResultType
    )

    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.ToString() -eq 'System.Threading.Tasks.Task`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation`1[TResult])'
        } |
        Select-Object -First 1

    $task = $method.MakeGenericMethod(@($ResultType)).Invoke($null, @($Operation))
    $task.Wait(-1) | Out-Null
    $task.Result
}

function Await-AsyncAction {
    param([Parameter(Mandatory = $true)] $Action)

    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.ToString() -eq 'System.Threading.Tasks.Task AsTask(Windows.Foundation.IAsyncAction)'
        } |
        Select-Object -First 1

    $task = $method.Invoke($null, @($Action))
    $task.Wait(-1) | Out-Null
}

$pdfPath = 'C:\Users\lnduarte\Downloads\Plano de ESTUDOS trf-3 V3.pdf'
$outputPath = 'C:\Users\lnduarte\Desktop\projeto-posse\tools\trf3_plan_ocr.txt'

$file = Await-AsyncOperation (
    [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]::GetFileFromPathAsync($pdfPath)
) ([Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime])

$pdf = Await-AsyncOperation (
    [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]::LoadFromFileAsync($file)
) ([Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime])

$language = New-Object ([Windows.Globalization.Language, Windows, ContentType = WindowsRuntime]) -ArgumentList 'pt-BR'
$ocrEngine = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]::TryCreateFromLanguage($language)

$pages = New-Object System.Collections.Generic.List[string]

for ($pageIndex = 0; $pageIndex -lt $pdf.PageCount; $pageIndex++) {
    Write-Output ("OCR page {0}/{1}" -f ($pageIndex + 1), $pdf.PageCount)

    $page = $pdf.GetPage($pageIndex)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth = [uint32]($page.Size.Width * 2)
    $options.DestinationHeight = [uint32]($page.Size.Height * 2)
    Await-AsyncAction ($page.RenderToStreamAsync($stream, $options))

    $decoder = Await-AsyncOperation (
        [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]::CreateAsync($stream)
    ) ([Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime])

    $bitmap = Await-AsyncOperation (
        $decoder.GetSoftwareBitmapAsync()
    ) ([Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime])

    $ocrResult = Await-AsyncOperation (
        $ocrEngine.RecognizeAsync($bitmap)
    ) ([Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime])

    $pages.Add("=== PAGE $($pageIndex + 1) ===`r`n$($ocrResult.Text)`r`n")
}

[System.IO.File]::WriteAllText($outputPath, ($pages -join "`r`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output ("OCR salvo em: {0}" -f $outputPath)
