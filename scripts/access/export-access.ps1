param(
  [string]$Source = "C:\Users\JukkaTaskinen\Adepta Oy\Asiakkaat - Tiedostot\00 tiedostot\Isännöinti\taloyhtiöt.accdb",
  [string]$OutDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "data\private"),
  # Vain talousvienti (access-finance-export.json); rekisterivientiä ja liitteitä ei kirjoiteta uudelleen.
  [switch]$VainTalous
)
# Access-vienti eRapun tuontia varten.
#
# - Lukee KOPION tiedostosta (alkuperäinen ei lukitu eikä muutu).
# - Vie vain nykyiset asiakasyhtiöt (lista alla, Jukan päätös 14.9.2026).
# - Henkilötunnuksia EI viedä: sarakkeita Hetu1, HeTu2 ja HeTu/Y-Tunnus ei lueta lainkaan.
# - Tulos kansioon data/private (gitignore). Kopio poistetaan lopuksi.
# - Talousvienti access-finance-export.json (scripts/access/import-finance.mts):
#   Vastikkeet ja Lainat kokonaan, yhtiön Yhtiön lainat -kenttä ja osakeryhmien
#   pinta-alat summien tarkistukseen. Mukana taulujen ja kyselyjen luettelo
#   ilman dataa, jotta raportti kertoo, mistä laina- ja vastiketiedot haettiin.

$ErrorActionPreference = "Stop"
$Clients = @(
  "As Oy Jussilantie 6", "As Oy Jäkälätie 3", "As Oy Kotipesä", "As Oy Paikkalankartano Matti",
  "As Oy Paikkalankartano Miina", "As Oy Toivakan Jussilanpuisto 4", "As Oy Toivakan Rantatuuli",
  "As Oy Vanhansillanpuisto", "Asunto Oy Paikkalan Torpat", "KOY Toivakan Säästövakka", "Toivakan Asunto Oy"
)

New-Item -ItemType Directory -Force $OutDir | Out-Null
$work = Join-Path $env:TEMP ("erappu-access-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
$copy = Join-Path $work "ty.accdb"
Copy-Item -LiteralPath $Source -Destination $copy

$engine = New-Object -ComObject DAO.DBEngine.120
$db = $engine.OpenDatabase($copy, $false, $true)

function Rows($sql, [string[]]$fields) {
  $rs = $db.OpenRecordset($sql)
  $list = New-Object System.Collections.ArrayList
  while (-not $rs.EOF) {
    $o = [ordered]@{}
    foreach ($f in $fields) {
      $v = $rs.Fields.Item($f).Value
      if ($v -is [datetime]) { $v = $v.ToString("yyyy-MM-dd") }
      if ($v -is [System.DBNull]) { $v = $null }
      $o[$f] = $v
    }
    [void]$list.Add([pscustomobject]$o)
    $rs.MoveNext()
  }
  $rs.Close()
  return ,$list
}

function SaveAttachments($table, $idField, $idValue, $attField, $targetDir) {
  $saved = @()
  $rs = $db.OpenRecordset("SELECT * FROM [$table] WHERE [$idField] = $idValue")
  if (-not $rs.EOF) {
    $att = $rs.Fields.Item($attField).Value
    while (-not $att.EOF) {
      $name = $att.Fields.Item("FileName").Value
      if ($name) {
        New-Item -ItemType Directory -Force $targetDir | Out-Null
        $path = Join-Path $targetDir $name
        if (Test-Path $path) { Remove-Item $path -Force }
        $att.Fields.Item("FileData").SaveToFile($path)
        $saved += $name
      }
      $att.MoveNext()
    }
  }
  $rs.Close()
  return $saved
}

$companyFields = @("ID","Yhtiö","Y-Tunnus","Osoite","Postinumero","Postitoimipaikka","Kiinteistötunnus","Yhtiöjärjestyksen pvm","Asuntojen lkm","Pinta-ala","Osakkeiden lukumäärä","Autopaikat kaavassa","Autopaikat toteutuneet","Sauna","Pesutupa","Mankeli","Kerhohuone","Askasteluhuone","Ulkoiluvälinevarasto","Vakuutusyhtiö","Vakuutustyyppi","Oma/vuokratontti","Tontin pinta-ala","Tontin vuokra-aika päättyy","Vuokran määrä/vuosi","Vuokran tarkistusperuste","Rakennusten lukumäärä","Porraskäytävät","Kerrosluku","tilavuus","Kerrosala","Huoneistoala","Käyttämätön rakennusoikeus","Valmistumisvuosi","Rakennusaine","Kattotyyppi","Katon katemateriaali","Lämmitysjärjestelmä","Ilmanvaihto","Antennijärjestelmä","Hissit","Kaupparekisterimerkinnän pvm ja rek nro","Sama vastikeperuste","Kiinteistönhoito","Osakekirjat painettava turvapainossa","Huoneistoselitelmää ei ole muutettu","Energiatodistus vuodelta","Talotyyppi","Lun_yhtiö","Lun_Osakas","Lun_muu","Lun_kun","Lun_laki","Lun_hitas","Lesken_hallinta","Muu_rajoitus")

$all = Rows "SELECT * FROM Yhtiöt" $companyFields
$companies = @($all | Where-Object { $Clients -contains $_."Yhtiö" })
$missing = @($Clients | Where-Object { $n = $_; -not ($companies | Where-Object { $_."Yhtiö" -eq $n }) })
$ids = ($companies | ForEach-Object { $_.ID }) -join ","

# ---------------------------------------------------------------------------
# Talousvienti
# ---------------------------------------------------------------------------
$inventory = New-Object System.Collections.ArrayList
foreach ($t in $db.TableDefs) {
  if ($t.Name -like "MSys*" -or $t.Name -like "~*") { continue }
  $rsc = $db.OpenRecordset("SELECT COUNT(*) FROM [$($t.Name)]")
  $count = $rsc.Fields.Item(0).Value
  $rsc.Close()
  $cols = @(); foreach ($f in $t.Fields) { $cols += $f.Name }
  [void]$inventory.Add([pscustomobject]@{ kind = "table"; name = $t.Name; rows = $count; columns = $cols; sql = $null })
}
foreach ($q in $db.QueryDefs) {
  if ($q.Name -like "~*") { continue }
  # Kyselyistä vain laina- ja vastiketauluja käyttävät, SQL mukaan (ei dataa).
  if ($q.SQL -match "Vastik|Laina") { [void]$inventory.Add([pscustomobject]@{ kind = "query"; name = $q.Name; rows = $null; columns = @(); sql = ($q.SQL -replace "\s+", " ").Trim() }) }
}
$finance = [ordered]@{
  exportedAt = (Get-Date).ToString("s")
  source = "taloyhtiöt.accdb"
  missingClients = $missing
  inventory = $inventory
  companies = Rows "SELECT ID, Yhtiö, [Yhtiön lainat], [Sama vastikeperuste], [Osakkeiden lukumäärä], [Pinta-ala], Huoneistoala, [Asuntojen lkm] FROM Yhtiöt WHERE ID IN ($ids)" @("ID","Yhtiö","Yhtiön lainat","Sama vastikeperuste","Osakkeiden lukumäärä","Pinta-ala","Huoneistoala","Asuntojen lkm")
  units = Rows "SELECT ID, Yhtiö, Asunnon_nro, koko, osakkeiden_määrä, Käyttötarkoitus, [Hakeuduttu alv-velvolliseksi] FROM asunnot WHERE Yhtiö IN ($ids)" @("ID","Yhtiö","Asunnon_nro","koko","osakkeiden_määrä","Käyttötarkoitus","Hakeuduttu alv-velvolliseksi")
  charges = Rows "SELECT ID, Yhtiö_id, Vastikelaji, Hoitovastike, HV_Muutos_pvn FROM Vastikkeet WHERE Yhtiö_id IN ($ids)" @("ID","Yhtiö_id","Vastikelaji","Hoitovastike","HV_Muutos_pvn")
  loans = Rows "SELECT ID, YhtiöId, [Yhtiön laina], [Lainan pvm], [Nostamattomat lainat, eur], [Nostamattomat lainat, pvm] FROM Lainat WHERE YhtiöId IN ($ids)" @("ID","YhtiöId","Yhtiön laina","Lainan pvm","Nostamattomat lainat, eur","Nostamattomat lainat, pvm")
}
$financeJson = $finance | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $OutDir "access-finance-export.json"), $financeJson, (New-Object System.Text.UTF8Encoding($false)))
"Talousvienti valmis: $($finance.charges.Count) vastikeriviä, $($finance.loans.Count) lainariviä, $($finance.units.Count) osakeryhmää."

if ($VainTalous) {
  $db.Close()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($engine) | Out-Null
  Remove-Item -LiteralPath $work -Recurse -Force
  if ($missing.Count) { "PUUTTUU ACCESSISTA: $($missing -join ', ')" }
  return
}

$lookups = [ordered]@{
  katteet = Rows "SELECT ID, Katemateriaali FROM Katteet" @("ID","Katemateriaali")
  vakuutusyhtiot = Rows "SELECT ID, Vakuutusyhtiö FROM Vakuutusyhtiöt" @("ID","Vakuutusyhtiö")
  kiinteistonhoito = Rows "SELECT ID, Hoitomuoto FROM Kiinteistöntoito" @("ID","Hoitomuoto")
}

$units = Rows "SELECT ID, Yhtiö, Asunnon_nro, koko, osakkeiden_määrä, Kenttä1, Osakkeet_numerot, [Asunnon tyyppi], Käyttötarkoitus, Vuokrattu, Asunnon_kerros FROM asunnot WHERE Yhtiö IN ($ids)" @("ID","Yhtiö","Asunnon_nro","koko","osakkeiden_määrä","Kenttä1","Osakkeet_numerot","Asunnon tyyppi","Käyttötarkoitus","Vuokrattu","Asunnon_kerros")
# Henkilötunnussarakkeita ei valita.
$owners = Rows "SELECT ID, Yhtiö_id, Asunto_Id, Omistaja, [Omistaja 1], Omistaja2, Om_osuus, [Merkitty omistajarekisteriin], Osoite, Postinumero, Postitoimipaikka, asukasnumero_Tikon FROM Omistajat WHERE Yhtiö_id IN ($ids) AND [Poistettu omistajarekisteristä] IS NULL" @("ID","Yhtiö_id","Asunto_Id","Omistaja","Omistaja 1","Omistaja2","Om_osuus","Merkitty omistajarekisteriin","Osoite","Postinumero","Postitoimipaikka","asukasnumero_Tikon")
$residents = Rows "SELECT ID, Yhtiö, Asunto, Asukas, Field80, Field81, Omistaja, Field84, Neliöt FROM Asukkaat WHERE Yhtiö IN ($ids)" @("ID","Yhtiö","Asunto","Asukas","Field80","Field81","Omistaja","Field84","Neliöt")
$charges = Rows "SELECT ID, Yhtiö_id, Vastikelaji, Hoitovastike, HV_Muutos_pvn FROM Vastikkeet WHERE Yhtiö_id IN ($ids)" @("ID","Yhtiö_id","Vastikelaji","Hoitovastike","HV_Muutos_pvn")
$loans = Rows "SELECT ID, YhtiöId, [Yhtiön laina], [Lainan pvm], [Nostamattomat lainat, eur], [Nostamattomat lainat, pvm] FROM Lainat WHERE YhtiöId IN ($ids)" @("ID","YhtiöId","Yhtiön laina","Lainan pvm","Nostamattomat lainat, eur","Nostamattomat lainat, pvm")
$repairs = Rows "SELECT ID, Yhtiö, [Ilmoituksen tyyppi], [Asunnon numero], Summary, Status, Kiireellisyys, [Korjauksen kohde], Päiväys, Avainsanat FROM Korjauspyynnöt WHERE Yhtiö IN ($ids)" @("ID","Yhtiö","Ilmoituksen tyyppi","Asunnon numero","Summary","Status","Kiireellisyys","Korjauksen kohde","Päiväys","Avainsanat")

$attachmentsRoot = Join-Path $OutDir "attachments"
$attachments = New-Object System.Collections.ArrayList
foreach ($c in $companies) {
  foreach ($field in @("Yhtiöjärjestys","Energiatodistus","Tasekirja","Talousarvio")) {
    $names = SaveAttachments "Yhtiöt" "ID" $c.ID $field (Join-Path $attachmentsRoot "yhtio-$($c.ID)\$field")
    foreach ($n in $names) { [void]$attachments.Add([pscustomobject]@{ companyId = $c.ID; field = $field; unitId = $null; file = "yhtio-$($c.ID)\$field\$n" }) }
  }
}
foreach ($u in $units) {
  $names = SaveAttachments "asunnot" "ID" $u.ID "Pohjakuva" (Join-Path $attachmentsRoot "asunto-$($u.ID)")
  foreach ($n in $names) { [void]$attachments.Add([pscustomobject]@{ companyId = $u."Yhtiö"; field = "Pohjakuva"; unitId = $u.ID; file = "asunto-$($u.ID)\$n" }) }
}

$db.Close()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($engine) | Out-Null
Remove-Item -LiteralPath $work -Recurse -Force

$export = [ordered]@{
  exportedAt = (Get-Date).ToString("s")
  source = "taloyhtiöt.accdb"
  missingClients = $missing
  lookups = $lookups
  companies = $companies
  units = $units
  owners = $owners
  residents = $residents
  charges = $charges
  loans = $loans
  repairs = $repairs
  attachments = $attachments
}
$json = $export | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $OutDir "access-export.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
"Vienti valmis: $($companies.Count) yhtiötä, $($units.Count) osakeryhmää, $($owners.Count) omistusta, $($residents.Count) asukasriviä, $($attachments.Count) liitettä."
if ($missing.Count) { "PUUTTUU ACCESSISTA: $($missing -join ', ')" }
