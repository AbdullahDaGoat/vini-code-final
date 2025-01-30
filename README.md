# Savingshub.watch Full Example

### Setup

1. Clone this repository
2. Create a `.env` file in the root directory with required variables (see `.env.example`).
3. `npm install`
4. `npm run start`

### Discord Configuration

- Create a new Application on Discord
- Create a Bot user and copy the token into `DISCORD_TOKEN` in `.env`
- Copy the Application (client) ID into `DISCORD_CLIENT_ID` in `.env`
- Invite the bot with proper slash-command permissions to your server

### How to Use

- In your Discord server, type:
  `/watch movie Titanic`
  or
  `/watch tv "Breaking Bad" season 1 episode 2`
- The bot will search TMDB, show top results, and let you pick.
- Once chosen, it will generate a short-lived link `savingshub.watch/<randomString>-<title>`
- The link expires after 3 hours.
- Enjoy streaming!
#   v i n i - c o d e - f i n a l  
 