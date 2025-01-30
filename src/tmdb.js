// tmdb.js
import fetch from 'node-fetch';

const TMDB_API_URL = "https://api.themoviedb.org/3";

export async function getTMDBSearchResults(type, query) {
  // type is either "movie" or "tv"
  // e.g. /search/movie or /search/tv
  const url = `${TMDB_API_URL}/search/${type}?api_key=${process.env.TMDB_API_KEY}&language=en-US&query=${encodeURIComponent(
    query
  )}&page=1&include_adult=false`;
  const resp = await fetch(url);
  const data = await resp.json();
  return data.results || [];
}

export async function getTMDBDetails(type, id) {
  // e.g. /movie/:id or /tv/:id
  const url = `${TMDB_API_URL}/${type}/${id}?api_key=${process.env.TMDB_API_KEY}&language=en-US`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return resp.json();
}