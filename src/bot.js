import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { getTMDBSearchResults, getTMDBDetails } from './tmdb.js';
import { createStreamLink, createBackupLink } from './server.js';

const { BASE_URL, DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;

const watchCommand = new SlashCommandBuilder()
  .setName("watch")
  .setDescription("Watch a movie or TV show.")
  .addStringOption(option =>
    option
      .setName("type")
      .setDescription("movie or tv")
      .setRequired(true)
      .addChoices(
        { name: "Movie", value: "movie" },
        { name: "TV Show", value: "tv" }
      )
  )
  .addStringOption(option =>
    option
      .setName("query")
      .setDescription("Title of the movie or TV show")
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option
      .setName("season")
      .setDescription("Season number (for TV shows)")
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName("episode")
      .setDescription("Episode number (for TV shows)")
      .setRequired(false)
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(DISCORD_CLIENT_ID),
    { body: [watchCommand.toJSON()] }
  );
  console.log("Slash commands registered globally.");
}

export function startBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });

  client.once("ready", () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "watch") {
        await handleWatchCommand(interaction);
      }
    } catch (err) {
      console.error("Error handling interaction:", err);
      if (interaction.replied || interaction.deferred) {
        interaction.followUp("Something went wrong.");
      } else {
        interaction.reply("Something went wrong.");
      }
    }
  });

  client.login(DISCORD_TOKEN);
  registerCommands();
}

async function handleWatchCommand(interaction) {
  const contentType = interaction.options.getString("type");
  const query = interaction.options.getString("query");
  const seasonNum = interaction.options.getInteger("season") || null;
  const episodeNum = interaction.options.getInteger("episode") || null;

  await interaction.deferReply({ ephemeral: true });

  const searchResults = await getTMDBSearchResults(contentType, query);
  if (!searchResults || searchResults.length === 0) {
    return interaction.editReply("No results found on TMDB.");
  }

  const topResults = searchResults.slice(0, 10);
  const options = topResults.map((r) => {
    const year = (r.release_date || r.first_air_date || "").split("-")[0] || "";
    return {
      label: `${r.title || r.name} (${year})`,
      description: `${r.overview?.substring(0, 50) || "No overview"}...`,
      value: String(r.id)
    };
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("tmdb_select")
      .setPlaceholder("Select the correct title...")
      .addOptions(options)
  );

  const replyMessage = await interaction.editReply({
    content: "Select the correct match:",
    components: [row]
  });

  const filter = (i) => i.customId === "tmdb_select" && i.user.id === interaction.user.id;
  const selectInteraction = await replyMessage.awaitMessageComponent({ filter, time: 30_000 }).catch(() => null);

  if (!selectInteraction) {
    return interaction.editReply({ content: "Timed out. Please try again.", components: [] });
  }

  const chosenId = selectInteraction.values[0];
  await selectInteraction.deferUpdate();

  const chosenData = await getTMDBDetails(contentType, chosenId);

  if (!chosenData) {
    return interaction.editReply("Could not retrieve details from TMDB.");
  }

  const [mainStream, backupStream] = await Promise.all([
    createStreamLink({
      type: contentType,
      tmdbId: chosenId,
      title: chosenData.title || chosenData.name,
      seasonNum,
      episodeNum
    }),
    createBackupLink({
      type: contentType,
      tmdbId: chosenId,
      title: chosenData.title || chosenData.name,
      seasonNum,
      episodeNum
    })
  ]);

  const formatCurrency = (amount) => {
    if (!amount) return "N/A";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };
  
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  
  const embed = new EmbedBuilder()
    .setTitle(`${chosenData.title || chosenData.name}`)
    .setDescription([
      chosenData.tagline ? `*"${chosenData.tagline}"*\n` : "",
      chosenData.overview || "No Description",
      "\n",
      chosenData.homepage ? `[Official Website](${chosenData.homepage})` : ""
    ].join(""))
    .setThumbnail(
      chosenData.poster_path
        ? `https://image.tmdb.org/t/p/w200${chosenData.poster_path}`
        : null
    )
    .addFields([
      {
        name: "Rating",
        value: [
          `⭐ ${chosenData.vote_average?.toFixed(1)}/10`,
          `(${chosenData.vote_count?.toLocaleString() || 0} votes)`,
          chosenData.adult ? "🔞 Adult" : "👨‍👩‍👧‍👦 Family"
        ].join(" • "),
        inline: true
      },
      {
        name: contentType === "movie" ? "Release Date" : "First Aired",
        value: `📅 ${formatDate(chosenData.release_date || chosenData.first_air_date)}`,
        inline: true
      },
      {
        name: "Languages",
        value: [
          `🌐 Original: ${chosenData.original_language?.toUpperCase() || "N/A"}`,
          `Available: ${chosenData.spoken_languages?.map(l => l.english_name).join(", ") || "N/A"}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Genres",
        value: `🎭 ${chosenData.genres?.map(g => g.name).join(", ") || "N/A"}`,
        inline: false
      }
    ])
    .setImage(
      chosenData.backdrop_path
        ? `https://image.tmdb.org/t/p/w500${chosenData.backdrop_path}`
        : null
    )
    .setColor("#00ADEF");
  
  // Add movie-specific fields
  if (contentType === "movie") {
    embed.addFields([
      {
        name: "Movie Details",
        value: [
          `⏱️ Runtime: ${Math.floor(chosenData.runtime / 60)}h ${chosenData.runtime % 60}m`,
          `💰 Budget: ${formatCurrency(chosenData.budget)}`,
          `💎 Revenue: ${formatCurrency(chosenData.revenue)}`,
          `🎬 Status: ${chosenData.status || "N/A"}`,
        ].join("\n"),
        inline: false
      },
      {
        name: "Production",
        value: [
          `🏢 Companies: ${chosenData.production_companies?.map(c => c.name).join(", ") || "N/A"}`,
          `🌍 Countries: ${chosenData.production_countries?.map(c => c.name).join(", ") || "N/A"}`
        ].join("\n"),
        inline: false
      }
    ]);
  
    if (chosenData.belongs_to_collection) {
      embed.addFields({
        name: "Collection",
        value: `📚 Part of: ${chosenData.belongs_to_collection.name}`,
        inline: false
      });
    }
  }
  
  // Add TV-specific fields
  if (contentType === "tv") {
    embed.addFields([
      {
        name: "TV Series Details",
        value: [
          `📺 Seasons: ${chosenData.number_of_seasons || "?"}`,
          `🎬 Episodes: ${chosenData.number_of_episodes || "?"}`,
          `📅 Last Aired: ${formatDate(chosenData.last_air_date)}`,
          `📌 Status: ${chosenData.status || "N/A"}`,
          `⏱️ Episode Runtime: ${chosenData.episode_run_time?.[0] || "?"} minutes`,
        ].join("\n"),
        inline: false
      },
      {
        name: "Network & Production",
        value: [
          `📺 Networks: ${chosenData.networks?.map(n => n.name).join(", ") || "N/A"}`,
          `🏢 Production Companies: ${chosenData.production_companies?.map(c => c.name).join(", ") || "N/A"}`,
          `🌍 Production Countries: ${chosenData.production_countries?.map(c => c.name).join(", ") || "N/A"}`
        ].join("\n"),
        inline: false
      }
    ]);
  
    if (chosenData.created_by?.length > 0) {
      embed.addFields({
        name: "Created By",
        value: chosenData.created_by.map(creator => creator.name).join(", "),
        inline: false
      });
    }
  
    if (chosenData.next_episode_to_air) {
      embed.addFields({
        name: "Next Episode",
        value: `📅 Airs on ${formatDate(chosenData.next_episode_to_air.air_date)}`,
        inline: false
      });
    }
  }
  
  // Add popularity and additional metrics
  embed.addFields({
    name: "Additional Information",
    value: [
      `📊 Popularity Score: ${chosenData.popularity?.toFixed(1) || "N/A"}`,
      `🔍 Original Title: ${chosenData.original_title || chosenData.original_name || "N/A"}`,
      contentType === "tv" ? `📺 Type: ${chosenData.type || "N/A"}` : "",
      contentType === "tv" ? `📝 In Production: ${chosenData.in_production ? "Yes" : "No"}` : "",
      `🔖 TMDB ID: ${chosenData.id}`
    ].filter(Boolean).join("\n"),
    inline: false
  });
  
  // Add credits if available
  if (chosenData.credits?.cast?.length > 0) {
    embed.addFields({
      name: "Top Cast",
      value: chosenData.credits.cast
        .slice(0, 5)
        .map(actor => `${actor.name} (${actor.character})`)
        .join("\n"),
      inline: false
    });
  }
  
  embed.setFooter({ 
    text: `Last Updated: ${new Date().toLocaleDateString()} • Data from TMDB`,
    iconURL: "https://www.themoviedb.org/assets/2/favicon-16x16-b362d267873ce9c5a39f686a11fe67fec2a72ed25fa8396c11b71aa43c938b11.png"
  });

  // Create two buttons: main stream and backup
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Watch Now")
      .setURL(mainStream.watchUrl)
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setLabel("Backup Stream")
      .setURL(backupStream.watchUrl)
      .setStyle(ButtonStyle.Link)
  );

  await interaction.editReply({
    content: "Here are your streaming options:",
    embeds: [embed],
    components: [buttonRow],
    ephemeral: true
  });
}