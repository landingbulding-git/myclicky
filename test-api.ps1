try {
    $body = '{"contents": [{"parts": [{"text": "Hello, can you hear me?"}]}]}';
    $response = Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$env:GEMINI_API_KEY" -Method POST -ContentType "application/json" -Body $body
    Write-Host "SUCCESS: $($response.candidates[0].content.parts[0].text)"
} catch {
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "HTTP ERROR:"
        $reader.ReadToEnd()
    } else {
        Write-Host "ERROR: $_"
    }
}
