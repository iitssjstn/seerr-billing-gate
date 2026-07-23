# Seerr Billing Gate

Klein zelf-gehost admin-paneeltje om Seerr-toegang te koppelen aan handmatig
bijgehouden contributiebetalingen (bv. via Tikkie, bankoverschrijving, etc.).

Er zit **geen** koppeling met een betaalprovider in dit project. Jij checkt
zelf of iemand betaald heeft (bv. via een Tikkie-notificatie) en klikt
vervolgens op "Markeer betaald" in het dashboard. De app regelt daarna
automatisch het aanmaken/verwijderen van het Seerr-account.

## Features

- Simpel ledenoverzicht met status (actief/inactief) en vervaldatum
- "Markeer betaald" → maakt (indien nodig) een Seerr-account aan via de Seerr API
- "Intrekken" → verwijdert het Seerr-account
- Optionele dagelijkse cron-check die verlopen betalingen automatisch intrekt
- Alles instelbaar via een webinterface (geen `.env` meer nodig voor Seerr-URL,
  API key of admin-wachtwoord)
- Eigen admin-account, aan te maken bij het eerste bezoek

## Vereisten

- Docker + Docker Compose
- Een draaiende Seerr-instance (los van deze app - deze repo bevat alleen de
  billing gate zelf)
- Een API key uit Seerr: **Instellingen → Algemeen → API key**

## Snel starten

```bash
git clone https://github.com/<jouw-gebruikersnaam>/seerr-billing-gate.git
cd seerr-billing-gate
docker compose up -d
```

Dat is alles — er is geen `.env`-bestand nodig om te starten. De app
genereert bij de eerste start zelf een sessiegeheim (opgeslagen in de
database, overleeft herstarts) en vraagt bij het eerste bezoek om een
admin-account aan te maken.

> Vereist Docker Compose v2.24 of nieuwer (voor de optionele `env_file`).
> Ouder? Maak dan zelf even een leeg `.env`-bestand aan naast
> `docker-compose.yml` voor je start.

Ga naar `http://<jouw-server>:3010`:

1. Bij het eerste bezoek vraagt de app om een **admin-account** aan te maken
   (gebruikersnaam + wachtwoord).
2. Ga daarna naar **Instellingen** en vul de **Seerr-URL** en **API key** in
   (te vinden in Seerr onder Instellingen → Algemeen). Gebruik de knop
   "Verbinding testen" om te checken of het klopt.
3. Klaar - je kan nu leden toevoegen en beheren vanaf het dashboard.

Wil je toch iets vastzetten (bv. een vaste poort of een zelfgekozen
sessiegeheim)? Kopieer `.env.example` naar `.env` en vul aan.

## Zonder Docker

```bash
npm install
npm start
```

(optioneel: `cp .env.example .env` als je iets wilt vastzetten)

## Hoe het werkt

1. Voeg een lid toe met naam + e-mailadres (nog geen Seerr-account nodig).
2. Zodra iemand betaald heeft, klik je op **Markeer betaald**. De app maakt
   automatisch een lokaal Seerr-account aan (of koppelt een bestaand account
   met hetzelfde e-mailadres) en zet de vervaldatum op vandaag + de ingestelde
   periode (standaard 30 dagen, aan te passen bij Instellingen).
3. Bij het verlopen van de betaling (indien "automatisch intrekken" aanstaat)
   of handmatig via **Intrekken**, wordt het Seerr-account verwijderd, waarmee
   de toegang stopt.

## Updaten

Elke push naar `main` bouwt via GitHub Actions automatisch een nieuwe image
op GHCR (`ghcr.io/<jouw-gebruikersnaam>/seerr-billing-gate`). Op je server
hoef je dan alleen:

```bash
docker compose pull
docker compose up -d
```

## Licentie

MIT
