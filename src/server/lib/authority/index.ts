/*
 * Oeffentliche Schnittstelle der Normdaten-Anbindung.
 *
 * Der Mappingkern schlaegt nichts selbst nach. Er sagt, was er braucht, und
 * bekommt es hereingereicht:
 *
 *   import { collectAuthorityLookups, runRow } from '../mapping/index.js'
 *   import { authorityServices, dbAuthorityCache, resolveAuthorities } from '../authority/index.js'
 *
 *   const bedarf  = collectAuthorityLookups(mapping, rows)
 *   const geloest = await resolveAuthorities(bedarf, {
 *     enabled: authorityEnabledFromEnv(),   // Standard: aus
 *     limit:   authorityLimitFromEnv(),     // AUTHORITY_LIMIT, Standard 500
 *     cache:   dbAuthorityCache(sql),
 *     schema
 *   })
 *
 *   for (const row of rows) {
 *     runRow(mapping, row, id, { schema, ...authorityServices(geloest) })
 *   }
 *
 * Laender und Sprachen brauchen kein Netz; authorityServices() haengt sie
 * ohnehin mit ein.
 *
 * Wer nicht selbst ueber Schalter, Obergrenze und Zwischenspeicher entscheiden
 * will, nimmt resolveForMapping() aus pipeline.ts. Vorschau und Konvertierung
 * tun genau das — damit beide dasselbe rechnen.
 */

/* ------------------------------------------------------------------ Typen */
export type {
  AuthorityCandidate, AuthorityKind, AuthorityResolution, AuthoritySource, NameForm
} from './types.js'
export {
  AUTHORITY_KINDS, AUTHORITY_SOURCES, EMPTY_RESOLUTION, KIND_CLASS, RESOURCE_TYPE,
  SOURCE_NAME_FORM, isAuthorityKind, isAuthoritySource, resourceTypeOf, sourceOfResourceType,
  toResolution
} from './types.js'

/* ------------------------------------------------------------------- HTTP */
export type { FetchJson, HttpOptions } from './http.js'
export {
  AUTHORITY_USER_AGENT, AuthorityHttpError, DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS,
  createFetchJson, retryAfterMs, statusRetryable
} from './http.js'

/* ------------------------------------------------------------ Namensformen */
export { comparableForms, compareForm, foldUmlauts, invertName, nameMatches, ohneLebensdaten, toInvertedForm } from './names.js'

/* ----------------------------------------------------------------- Quellen */
export { GND_SEARCH_URL, gndSearchUrl, parseGnd, searchGnd } from './gnd.js'
export { WIKIDATA_API, parseWikidata, searchWikidata, wikidataSearchUrl } from './wikidata.js'
export { VIAF_AUTOSUGGEST, parseViaf, searchViaf, viafNeedsInvertedQuery, viafSearchUrl } from './viaf.js'

/* ----------------------------------------------------------- Zwischenspeicher */
export type { AuthorityCache, DbCacheOptions, MemoryAuthorityCache } from './cache.js'
export {
  AUTHORITY_CACHE_GENERATION, cacheKey, cacheSourceColumn, countAuthorityCache,
  dbAuthorityCache, dropAuthorityCacheGeneration, layeredAuthorityCache,
  memoryAuthorityCache, noAuthorityCache, purgeAuthorityCache
} from './cache.js'

/* ------------------------------------------------------------- Aufloesung */
export type { AuthorityLookupOptions, AuthorityStats, ResolvedAuthorities } from './resolve.js'
export {
  DEFAULT_AUTHORITY_LIMIT, authorityEnabledFromEnv, authorityKey, authorityLimitFromEnv,
  decide, exactMatches, noAuthorities, resolveAuthorities, sourceAllowed
} from './resolve.js'

/* --------------------------------------------------------- Editor-Nachschlag */
export type { AuthorityDetail, ScoredCandidate, SearchOptions } from './search.js'
export { authorityCandidates, authorityDetail, sourcesForKind } from './search.js'

/* ----------------------------------------------------------------- Laender */
export type { CountryEntry, CountryHit } from './countries.js'
export {
  COUNTRY_EXTRA, allCountries, countryKey, countryKeyCount, countryTableSize, lookupCountry
} from './countries.js'

/* ---------------------------------------------------------------- Sprachen */
export type { LanguageEntry } from './languages.js'
export {
  LANGUAGE_EXTRA, allLanguages, languageEntry, languageKey, languageKeyCount,
  languageLabel, languageTableSize, lookupLanguage
} from './languages.js'

/* ------------------------------------------------------------- Einhaengen */
export { authorityServices } from './services.js'

/* -------------------------------------------------- Vorab-Aufloesung */
export type { AuthorityRunOptions } from './pipeline.js'
export { PREVIEW_AUTHORITY_LIMIT, mappingServicesFor, resolveForMapping } from './pipeline.js'
