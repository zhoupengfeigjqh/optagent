Set-Location 'd:\公司项目\智能体\optagent\agent-backend'
$env:CI = 'true'
& npx vitest run *> check-be.txt
"exit=$LASTEXITCODE" | Out-File -Append -Encoding utf8 check-be.txt
& npm run build *>> check-be.txt
"build=$LASTEXITCODE" | Out-File -Append -Encoding utf8 check-be.txt
