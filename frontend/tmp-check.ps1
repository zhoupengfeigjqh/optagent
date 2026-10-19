Set-Location 'd:\公司项目\智能体\optagent\frontend'
$env:CI = 'true'
& npx vitest run --coverage --reporter=dot *> check-out.txt
"exit=$LASTEXITCODE" | Out-File -Append -Encoding utf8 check-out.txt
