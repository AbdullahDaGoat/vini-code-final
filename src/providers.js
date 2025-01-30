// providers.js

import fetch from "node-fetch";
import {
  makeProviders,
  makeStandardFetcher,
  targets
} from "@movie-web/providers";

const myFetcher = makeStandardFetcher(fetch);

const providers = makeProviders({
  fetcher: myFetcher,
  target: targets.NATIVE,
  consistentIpForRequests: false
});

/**
 * If runAll() returns a single provider object instead of an array,
 * convert it into an array shape for consistency. 
 *
 * The normal shape for an array-based result is:
 * [
 *   {
 *     id: "some-provider-id",
 *     name: "Provider name",
 *     streams: [ { type, playlist, qualities, captions, ...}, ... ]
 *   },
 *   ...
 * ]
 *
 * But sometimes we get a single object: 
 * {
 *   sourceId: 'autoembed',
 *   embedId: 'autoembed-english',
 *   stream: { type: 'hls', playlist: '...', captions: [...] }
 * }
 */
function unifyProviderOutputs(providerOutputs) {
  if (!providerOutputs) {
    return [];
  }

  // If it's already an array, just return it
  if (Array.isArray(providerOutputs)) {
    return providerOutputs;
  }

  // If there's a single object with .stream
  if (providerOutputs.stream) {
    return [
      {
        id: providerOutputs.sourceId || "unknown",
        name: providerOutputs.embedId || "Unnamed",
        // Ensure it's an array of streams
        streams: [providerOutputs.stream]
      }
    ];
  }

  // Fallback: if it's an object with .streams maybe
  if (providerOutputs.streams) {
    // wrap it
    return [providerOutputs];
  }

  // If none of the above, return an empty array
  return [];
}

/**
 * Score the file-based stream by highest resolution.
 * e.g. '4k' -> 4000, '1080' -> 1080, '720' -> 720, etc.
 */
function getHighestFileResolution(qualitiesMap = {}) {
  const resolutionRanking = {
    "4k": 4000,
    "1080": 1080,
    "720": 720,
    "480": 480,
    "360": 360,
    "unknown": 0
  };

  let best = 0;
  for (const key of Object.keys(qualitiesMap)) {
    const score = resolutionRanking[key] || 0;
    if (score > best) best = score;
  }
  return best;
}

/**
 * Heuristic to pick the "best" stream from all provider outputs.
 * 
 * Priority rules in this sample:
 * 1. HLS streams are always preferred over file-based.
 * 2. If file-based, choose the highest resolution in [4k, 1080, 720, 480, 360].
 */
function pickBestStream(providerOutputs) {
  let chosenStream = null;
  let chosenScore = 0; // bigger = better

  for (const provider of providerOutputs) {
    if (!provider.streams || !Array.isArray(provider.streams)) {
      continue;
    }
    for (const stream of provider.streams) {
      if (stream.type === "hls") {
        // Arbitrary large score to push HLS above file
        const score = 9999;
        if (score > chosenScore) {
          chosenScore = score;
          chosenStream = stream;
        }
      } else if (stream.type === "file") {
        const resolutionScore = getHighestFileResolution(stream.qualities);
        if (resolutionScore > chosenScore) {
          chosenScore = resolutionScore;
          chosenStream = stream;
        }
      }
    }
  }

  return chosenStream;
}

/**
 * Scrape streams from all providers for given media,
 * unify them into an array,
 * then pick the single best stream from that array.
 */
export async function getBestStreamForMedia({ type, tmdbId, seasonNum, episodeNum }) {
  const media = {
    type: type === "movie" ? "movie" : "tv",
    tmdbId,
    // optional
    title: "",
    releaseYear: null,
    season: seasonNum || null,
    episode: episodeNum || null
  };

  console.log("DEBUG: Calling providers.runAll for media:", media);

  let rawOutput;
  try {
    rawOutput = await providers.runAll({ media });
  } catch (err) {
    console.error("ERROR: providers.runAll threw:", err);
    return null;
  }

  console.log("DEBUG: rawOutput from runAll:", rawOutput);

  // Convert rawOutput to a standard array shape
  const providerOutputs = unifyProviderOutputs(rawOutput);

  if (!providerOutputs.length) {
    console.log("DEBUG: No provider outputs found after unify.");
    return null;
  }
  console.log("DEBUG: unified providerOutputs:", providerOutputs);

  // Pick the single best stream
  const bestStream = pickBestStream(providerOutputs);

  console.log("DEBUG: bestStream after pickBestStream:", bestStream);

  // Return that bestStream to the server
  return bestStream;
}
