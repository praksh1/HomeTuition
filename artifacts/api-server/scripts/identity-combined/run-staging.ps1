# Uses the two owner-saved, still-pending private R2 keys only inside this process.
# Never prints their values, commits Railway's staging patch, or changes collection flags.
$ErrorActionPreference = 'Stop'
$fadkoService = 'cc10a94f-b24b-47bc-ae5c-ec2a9307cfa0'
$fadkoEnvironment = '21069a21-dcdc-4215-9f88-81b8b5f2c95c'
$fadkoActive = railway.cmd variable list --service $fadkoService --environment $fadkoEnvironment --json | ConvertFrom-Json
$fadkoPatch = railway.cmd api 'query($id:String!){environmentStagedChanges(environmentId:$id){status patch(decryptVariables:true)}}' --raw-var id=$fadkoEnvironment --compact | ConvertFrom-Json
$fadkoStaged = $fadkoPatch.data.environmentStagedChanges.patch.services.$fadkoService.variables
$fadkoServices = @($fadkoPatch.data.environmentStagedChanges.patch.services.PSObject.Properties.Name)
$fadkoNames = @($fadkoStaged.PSObject.Properties.Name | Sort-Object)
if ($fadkoPatch.data.environmentStagedChanges.status -ne 'STAGED' -or
    ($fadkoServices -join ',') -ne $fadkoService -or
    ($fadkoNames -join ',') -ne 'IDENTITY_R2_ACCESS_KEY_ID,IDENTITY_R2_SECRET_ACCESS_KEY') {
    throw 'Unexpected Railway staging patch'
}
if ($fadkoActive.RAILWAY_SERVICE_ID -ne $fadkoService -or
    $fadkoActive.PUBLIC_APP_URL -ne 'https://hometuition-preview.praksh-dhakal.workers.dev' -or
    $fadkoActive.IDENTITY_COLLECTION_ENABLED -eq 'true' -or
    $fadkoActive.R2_ACCOUNT_ID -ne 'ede5359f6838749186039c7a4ce2278c') {
    throw 'Unexpected active staging target'
}
$env:RAILWAY_SERVICE_ID = $fadkoActive.RAILWAY_SERVICE_ID
$env:PUBLIC_APP_URL = $fadkoActive.PUBLIC_APP_URL
$env:DATABASE_URL = $fadkoActive.DATABASE_URL
$env:IDENTITY_COLLECTION_ENABLED = $fadkoActive.IDENTITY_COLLECTION_ENABLED
$env:IDENTITY_R2_BUCKET = 'fadko-staging-private-identity'
$env:IDENTITY_R2_ACCESS_KEY_ID = $fadkoStaged.IDENTITY_R2_ACCESS_KEY_ID.value
$env:IDENTITY_R2_SECRET_ACCESS_KEY = $fadkoStaged.IDENTITY_R2_SECRET_ACCESS_KEY.value
$env:R2_ACCOUNT_ID = $fadkoActive.R2_ACCOUNT_ID
$env:R2_BUCKET = $fadkoActive.R2_BUCKET
$env:R2_ENDPOINT = $fadkoActive.R2_ENDPOINT
node scripts/identity-combined/run.mjs
exit $LASTEXITCODE
