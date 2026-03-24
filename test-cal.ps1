$headers = @{
  "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtenB6aXlyaGFlYWJsd2ttYXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTI0NDMsImV4cCI6MjA4ODcyODQ0M30.plgBU8WVHx01LmzhCUCO6lGcn3jqUR6a2QgzgCJkRJE"
  "Content-Type" = "application/json"
}
Invoke-WebRequest -Method POST -Uri "https://pmzpziyrhaeablwkmaxg.supabase.co/functions/v1/scrape-oracle" -Headers $headers -Body '{"slug":"cal"}' -TimeoutSec 300 | Select-Object -ExpandProperty Content
