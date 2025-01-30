// backup.js

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

/**
 * List of trackers to append to our magnet link.
 */
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.ololosh.space:6969/announce',
  'udp://tracker.dump.cl:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://opentracker.io:6969/announce',
  'udp://open.free-tracker.ga:6969/announce',
  'udp://ns-1.x-fins.com:6969/announce',
  'udp://leet-tracker.moe:1337/announce',
  'udp://isk.richardsw.club:6969/announce',
  'udp://discord.heihachi.pw:6969/announce',
  'http://www.torrentsnipe.info:2701/announce',
  'http://www.genesis-sp.org:2710/announce'
];

/**
 * 1) Convert TMDB ID -> IMDB ID
 */
async function getImdbIdFromTmdb({ type, tmdbId }) {
  // type is "movie" or "tv"
  // For a movie: GET /movie/{tmdbId}/external_ids
  // For a tv: GET /tv/{tmdbId}/external_ids
  const baseUrl = 'https://api.themoviedb.org/3';
  const url = `${baseUrl}/${type}/${tmdbId}/external_ids?api_key=${process.env.TMDB_API_KEY}`;
  console.log('DEBUG: getImdbIdFromTmdb ->', url);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`TMDB External IDs error: ${resp.statusText}`);
  }
  const data = await resp.json();
  // data.imdb_id might be null sometimes if not found
  if (!data.imdb_id) {
    console.log('DEBUG: IMDB ID not found in external_ids payload:', data);
    return null;
  }
  return data.imdb_id; // e.g. "tt6226232"
}

/**
 * 2) Build the torrentio API endpoint 
 *    e.g. /stream/movie/:imdbId.json
 *    or /stream/series/:imdbId:season:episode.json
 */
function buildTorrentioUrl(type, imdbId, seasonNum, episodeNum) {
  // List your providers:
  const providers = 'providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex';
  
  if (type === 'movie') {
    // e.g. 
    // https://torrentio.strem.fun/providers=.../stream/movie/:imdbId.json
    return `https://torrentio.strem.fun/${providers}/stream/movie/${imdbId}.json`;
  } else {
    // e.g.
    // https://torrentio.strem.fun/providers=.../stream/series/:imdbId:seasonNum:episodeNum.json
    return `https://torrentio.strem.fun/${providers}/stream/series/${imdbId}:${seasonNum}:${episodeNum}.json`;
  }
}

/**
 * 3) Fetch torrent streams from torrentio
 *    returns the JSON (with "streams": [ ... ])
 */
async function fetchTorrentioStreams({ type, imdbId, seasonNum, episodeNum }) {
  const url = buildTorrentioUrl(type, imdbId, seasonNum, episodeNum);
  console.log('DEBUG: torrentio URL ->', url);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Torrentio error: ${resp.statusText}`);
  }
  const data = await resp.json();
  return data; // shape: { streams: [...] }
}

/**
 * 4) Pick the "best" from the torrentio 'streams' array
 *    We'll do a basic heuristic: prefer 2160p / 4k, then 1080p, 720p, etc.
 *    We can guess resolution from the "name" or "title" strings.
 */
function pickBestTorrentStream(streams) {
  if (!Array.isArray(streams) || !streams.length) {
    return null;
  }

  // You can get creative with better heuristics (seed count, file size, etc.)
  // For now, we just parse the name or title for known keywords.
  const resolutionRanking = ["2160p", "4k", "1080p", "720p", "480p", "360p"];
  
  let chosen = null;
  let chosenRank = -9999;
  
  for (const s of streams) {
    // We want to see if s.title or s.name includes "2160p" or "1080p", etc.
    let rank = -1;
    for (let i = 0; i < resolutionRanking.length; i++) {
      const res = resolutionRanking[i];
      if (s.title?.toLowerCase().includes(res) || s.name?.toLowerCase().includes(res)) {
        rank = resolutionRanking.length - i; 
        // bigger i => smaller rank, so let's invert
        break;
      }
    }
    if (rank > chosenRank) {
      chosenRank = rank;
      chosen = s;
    }
  }
  
  return chosen;
}

/**
 * 5) Build a magnet link from the selected stream
 *    (we only have .infoHash and maybe .title).
 */
function buildMagnetLink(infoHash, name) {
    const base = `magnet:?xt=urn:btih:${infoHash}`;
    
    // &dn=some-encoded-name
    let magnet = base;
    if (name) {
      magnet += `&dn=${encodeURIComponent(name)}`;
    }
    
    // add trackers
    for (const t of TRACKERS) {
      magnet += `&tr=${encodeURIComponent(t)}`;
    }
    
    return magnet;
  }
/**
 * 6) Call your "fetchHls" endpoint to convert magnet -> m3u8
 *    For example: https://savingshub.online/api/fetchHls?magnet=<encodedMagnet>
 *    or https://savingshub.online/fetchHls?magnet=...
 */
async function fetchM3u8FromMagnet(magnetLink) {
    const baseUrl = "https://savingshub.online/api/fetchHls";
    
    // Double encode the magnet parameter - first the magnet link itself, then the whole parameter
    const encodedMagnet = encodeURIComponent(magnetLink);
    const fullUrl = `${baseUrl}?magnet=${encodedMagnet}`;
  
    console.log('DEBUG: fetchM3u8FromMagnet ->', fullUrl);
  
    const resp = await fetch(fullUrl);
    if (!resp.ok) {
      throw new Error(`fetchHls error: ${resp.statusText}`);
    }
    const data = await resp.json();
    if (!data.m3u8Link) {
      throw new Error("No m3u8Link in fetchHls response");
    }
    return data.m3u8Link;
  }

/**
 * 7) The main "backup" function:
 *    - get IMDB ID from TMDB
 *    - fetch torrentio streams
 *    - pick best
 *    - build magnet
 *    - fetch .m3u8
 *    - return { type: 'hls', playlist: <theM3u8Url> }
 */
export async function getBackupHlsForMedia({ type, tmdbId, title, seasonNum, episodeNum }) {
  // 1) Get IMDB ID
  const imdbId = await getImdbIdFromTmdb({ type, tmdbId });
  if (!imdbId) {
    console.log("WARN: Could not find IMDB ID from TMDB external_ids!");
    return null;
  }

  // 2) fetch torrentio
  const torrentioData = await fetchTorrentioStreams({ type, imdbId, seasonNum, episodeNum });
  if (!torrentioData || !torrentioData.streams) {
    console.log("WARN: No streams found from torrentio");
    return null;
  }

  // 3) pick best
  const bestTorrent = pickBestTorrentStream(torrentioData.streams);
  if (!bestTorrent) {
    console.log("WARN: no bestTorrent from pickBestTorrentStream");
    return null;
  }

  console.log("DEBUG: bestTorrent =>", bestTorrent);

  // build magnet
  const magnetLink = buildMagnetLink(bestTorrent.infoHash, bestTorrent.name || bestTorrent.title);
  console.log("DEBUG: magnetLink =>", magnetLink);

  // 4) fetch .m3u8
  const m3u8Link = await fetchM3u8FromMagnet(magnetLink);
  console.log("DEBUG: final m3u8 =>", m3u8Link);

  // Return an object that your front-end can interpret 
  // exactly like your "bestStream" from @movie-web/providers:
  return {
    type: 'hls',
    playlist: m3u8Link,
    captions: [] // or additional logic for subtitles if you have them
  };
}
