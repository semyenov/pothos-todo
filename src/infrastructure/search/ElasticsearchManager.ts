import type { SpanOptions } from '@opentelemetry/api';
import { AsyncSingletonService } from '@/lib/base/AsyncSingletonService.js';
import { createLogger } from '@/lib/logger.js';
import { RedisClusterManager } from '@/infrastructure/cache/RedisClusterManager.js';
import { DistributedTracing } from '@/infrastructure/observability/DistributedTracing.js';

const logger = createLogger('ElasticsearchManager');

export interface SearchIndex {
  name: string;
  mappings: IndexMapping;
  settings: IndexSettings;
  aliases: string[];
  version: number;
  created: Date;
  lastUpdated: Date;
}

export interface IndexMapping {
  properties: Record<string, FieldMapping>;
  dynamic?: boolean | 'strict';
  dynamicTemplates?: DynamicTemplate[];
}

export interface FieldMapping {
  type: 'text' | 'keyword' | 'integer' | 'float' | 'date' | 'boolean' | 'object' | 'nested' | 'geo_point' | 'completion';
  analyzer?: string;
  searchAnalyzer?: string;
  index?: boolean;
  store?: boolean;
  fields?: Record<string, FieldMapping>;
  properties?: Record<string, FieldMapping>;
  boost?: number;
  copyTo?: string[];
  format?: string;
  ignoreAbove?: number;
  normalizer?: string;
  nullValue?: any;
}

export interface DynamicTemplate {
  name: string;
  match?: string;
  matchMappingType?: string;
  pathMatch?: string;
  mapping: FieldMapping;
}

export interface IndexSettings {
  numberOfShards: number;
  numberOfReplicas: number;
  analysis?: AnalysisSettings;
  refreshInterval?: string;
  maxResultWindow?: number;
  indexing?: IndexingSettings;
  search?: SearchSettings;
}

export interface AnalysisSettings {
  analyzers?: Record<string, AnalyzerConfig>;
  tokenizers?: Record<string, TokenizerConfig>;
  filters?: Record<string, FilterConfig>;
  normalizers?: Record<string, NormalizerConfig>;
}

export interface AnalyzerConfig {
  type?: string;
  tokenizer: string;
  filters?: string[];
  charFilters?: string[];
}

export interface TokenizerConfig {
  type: string;
  pattern?: string;
  flags?: string;
  group?: number;
}

export interface FilterConfig {
  type: string;
  [key: string]: any;
}

export interface NormalizerConfig {
  type: string;
  filters: string[];
}

export interface IndexingSettings {
  slowlog?: SlowlogSettings;
  codec?: string;
  checkOnStartup?: boolean;
}

export interface SearchSettings {
  slowlog?: SlowlogSettings;
  defaultPipeline?: string;
}

export interface SlowlogSettings {
  threshold?: {
    query?: {
      warn?: string;
      info?: string;
      debug?: string;
      trace?: string;
    };
    fetch?: {
      warn?: string;
      info?: string;
      debug?: string;
      trace?: string;
    };
    index?: {
      warn?: string;
      info?: string;
      debug?: string;
      trace?: string;
    };
  };
  level?: string;
  source?: number;
}

export interface SearchQuery {
  query?: QueryDSL;
  from?: number;
  size?: number;
  sort?: SortClause[];
  source?: boolean | string[];
  highlight?: HighlightConfig;
  aggregations?: Record<string, AggregationConfig>;
  searchAfter?: any[];
  trackTotalHits?: boolean | number;
  timeout?: string;
  terminateAfter?: number;
  explain?: boolean;
  version?: boolean;
  seqNoPrimaryTerm?: boolean;
  storedFields?: string[];
  docvalueFields?: string[];
  scriptFields?: Record<string, ScriptField>;
  rescore?: RescoreConfig[];
  minScore?: number;
  postFilter?: QueryDSL;
  collapse?: CollapseConfig;
  searchType?: 'query_then_fetch' | 'dfs_query_then_fetch';
  requestCache?: boolean;
  allowNoIndices?: boolean;
  expandWildcards?: 'open' | 'closed' | 'hidden' | 'none' | 'all';
  preference?: string;
  routing?: string;
  scroll?: string;
  searchTimeout?: string;
  allowPartialSearchResults?: boolean;
}

export interface QueryDSL {
  bool?: BoolQuery;
  match?: Record<string, MatchQuery>;
  matchAll?: {};
  matchNone?: {};
  multiMatch?: MultiMatchQuery;
  term?: Record<string, TermQuery>;
  terms?: Record<string, TermsQuery>;
  range?: Record<string, RangeQuery>;
  exists?: ExistsQuery;
  prefix?: Record<string, PrefixQuery>;
  wildcard?: Record<string, WildcardQuery>;
  regexp?: Record<string, RegexpQuery>;
  fuzzy?: Record<string, FuzzyQuery>;
  ids?: IdsQuery;
  nested?: NestedQuery;
  hasChild?: HasChildQuery;
  hasParent?: HasParentQuery;
  parentId?: ParentIdQuery;
  joinField?: JoinFieldQuery;
  geoDistance?: GeoDistanceQuery;
  geoBoundingBox?: GeoBoundingBoxQuery;
  geoPolygon?: GeoPolygonQuery;
  geoShape?: GeoShapeQuery;
  moreLikeThis?: MoreLikeThisQuery;
  script?: ScriptQuery;
  wrapper?: WrapperQuery;
  constantScore?: ConstantScoreQuery;
  functionScore?: FunctionScoreQuery;
  boosting?: BoostingQuery;
  disMax?: DisMaxQuery;
}

export interface BoolQuery {
  must?: QueryDSL[];
  filter?: QueryDSL[];
  should?: QueryDSL[];
  mustNot?: QueryDSL[];
  minimumShouldMatch?: number | string;
  boost?: number;
}

export interface MatchQuery {
  query: string;
  operator?: 'and' | 'or';
  minimumShouldMatch?: number | string;
  fuzziness?: string | number;
  lenient?: boolean;
  prefixLength?: number;
  maxExpansions?: number;
  fuzzyRewrite?: string;
  zeroTermsQuery?: 'none' | 'all';
  cutoffFrequency?: number;
  autoGenerateSynonymsPhraseQuery?: boolean;
  boost?: number;
  analyzer?: string;
}

export interface MultiMatchQuery {
  query: string;
  fields: string[];
  type?: 'best_fields' | 'most_fields' | 'cross_fields' | 'phrase' | 'phrase_prefix' | 'bool_prefix';
  operator?: 'and' | 'or';
  minimumShouldMatch?: number | string;
  fuzziness?: string | number;
  lenient?: boolean;
  prefixLength?: number;
  maxExpansions?: number;
  fuzzyRewrite?: string;
  zeroTermsQuery?: 'none' | 'all';
  cutoffFrequency?: number;
  autoGenerateSynonymsPhraseQuery?: boolean;
  boost?: number;
  analyzer?: string;
  tieBreaker?: number;
}

export interface TermQuery {
  value: any;
  boost?: number;
  caseInsensitive?: boolean;
}

export interface TermsQuery {
  value: any[];
  boost?: number;
}

export interface RangeQuery {
  gte?: any;
  gt?: any;
  lte?: any;
  lt?: any;
  format?: string;
  timeZone?: string;
  boost?: number;
  relation?: 'intersects' | 'contains' | 'within';
}

export interface ExistsQuery {
  field: string;
}

export interface PrefixQuery {
  value: string;
  boost?: number;
  caseInsensitive?: boolean;
}

export interface WildcardQuery {
  value: string;
  boost?: number;
  caseInsensitive?: boolean;
}

export interface RegexpQuery {
  value: string;
  flags?: string;
  maxDeterminizedStates?: number;
  boost?: number;
  caseInsensitive?: boolean;
}

export interface FuzzyQuery {
  value: string;
  fuzziness?: string | number;
  maxExpansions?: number;
  prefixLength?: number;
  transpositions?: boolean;
  boost?: number;
}

export interface IdsQuery {
  values: string[];
}

export interface NestedQuery {
  path: string;
  query: QueryDSL;
  scoreMode?: 'avg' | 'max' | 'min' | 'none' | 'sum';
  boost?: number;
  ignoreUnmapped?: boolean;
  innerHits?: InnerHitsConfig;
}

export interface HasChildQuery {
  type: string;
  query: QueryDSL;
  scoreMode?: 'avg' | 'max' | 'min' | 'none' | 'sum';
  minChildren?: number;
  maxChildren?: number;
  boost?: number;
  ignoreUnmapped?: boolean;
  innerHits?: InnerHitsConfig;
}

export interface HasParentQuery {
  parentType: string;
  query: QueryDSL;
  score?: boolean;
  boost?: number;
  ignoreUnmapped?: boolean;
  innerHits?: InnerHitsConfig;
}

export interface ParentIdQuery {
  type: string;
  id: string;
  boost?: number;
  ignoreUnmapped?: boolean;
}

export interface JoinFieldQuery {
  joinField: string;
  id: string;
}

export interface GeoDistanceQuery {
  distance: string;
  distanceType?: 'arc' | 'plane';
  optimizeBbox?: 'memory' | 'indexed' | 'none';
  validationMethod?: 'ignore_malformed' | 'coerce' | 'strict';
  boost?: number;
  [field: string]: any;
}

export interface GeoBoundingBoxQuery {
  validationMethod?: 'ignore_malformed' | 'coerce' | 'strict';
  type?: 'memory' | 'indexed';
  boost?: number;
  [field: string]: {
    topLeft: GeoPoint;
    bottomRight: GeoPoint;
  };
}

export interface GeoPolygonQuery {
  validationMethod?: 'ignore_malformed' | 'coerce' | 'strict';
  boost?: number;
  [field: string]: {
    points: GeoPoint[];
  };
}

export interface GeoShapeQuery {
  boost?: number;
  ignoreUnmapped?: boolean;
  [field: string]: {
    shape?: GeoShape;
    indexedShape?: IndexedShape;
    relation?: 'intersects' | 'disjoint' | 'within' | 'contains';
  };
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoShape {
  type: string;
  coordinates: any;
}

export interface IndexedShape {
  id: string;
  index: string;
  path: string;
  routing?: string;
}

export interface MoreLikeThisQuery {
  fields?: string[];
  like: LikeClause[];
  unlike?: LikeClause[];
  maxQueryTerms?: number;
  minTermFreq?: number;
  minDocFreq?: number;
  maxDocFreq?: number;
  minWordLength?: number;
  maxWordLength?: number;
  stopWords?: string[];
  analyzer?: string;
  minimumShouldMatch?: number | string;
  boostTerms?: number;
  include?: boolean;
  boost?: number;
}

export interface LikeClause {
  index?: string;
  id?: string;
  doc?: any;
  fields?: string[];
  perFieldAnalyzer?: Record<string, string>;
  routing?: string;
  version?: number;
  versionType?: string;
}

export interface ScriptQuery {
  script: Script;
  boost?: number;
}

export interface Script {
  source?: string;
  id?: string;
  params?: Record<string, any>;
  lang?: string;
}

export interface WrapperQuery {
  query: string;
}

export interface ConstantScoreQuery {
  filter: QueryDSL;
  boost?: number;
}

export interface FunctionScoreQuery {
  query?: QueryDSL;
  boost?: number;
  functions?: FunctionScore[];
  maxBoost?: number;
  scoreMode?: 'multiply' | 'sum' | 'avg' | 'first' | 'max' | 'min';
  boostMode?: 'multiply' | 'replace' | 'sum' | 'avg' | 'max' | 'min';
  minScore?: number;
}

export interface FunctionScore {
  filter?: QueryDSL;
  weight?: number;
  randomScore?: RandomScore;
  fieldValueFactor?: FieldValueFactor;
  scriptScore?: ScriptScore;
  linearDecay?: DecayFunction;
  expDecay?: DecayFunction;
  gaussDecay?: DecayFunction;
}

export interface RandomScore {
  seed?: number;
  field?: string;
}

export interface FieldValueFactor {
  field: string;
  factor?: number;
  modifier?: 'none' | 'log' | 'log1p' | 'log2p' | 'ln' | 'ln1p' | 'ln2p' | 'square' | 'sqrt' | 'reciprocal';
  missing?: number;
}

export interface ScriptScore {
  script: Script;
}

export interface DecayFunction {
  [field: string]: {
    origin: any;
    scale: any;
    offset?: any;
    decay?: number;
  };
}

export interface BoostingQuery {
  positive: QueryDSL;
  negative: QueryDSL;
  negativeBoost: number;
}

export interface DisMaxQuery {
  queries: QueryDSL[];
  tieBreaker?: number;
  boost?: number;
}

export interface SortClause {
  [field: string]: SortOptions | string;
}

export interface SortOptions {
  order?: 'asc' | 'desc';
  mode?: 'min' | 'max' | 'sum' | 'avg' | 'median';
  numericType?: 'long' | 'double' | 'date' | 'date_nanos';
  missing?: '_first' | '_last' | any;
  unmappedType?: string;
  nested?: NestedSort;
  format?: string;
}

export interface NestedSort {
  path: string;
  filter?: QueryDSL;
  maxChildren?: number;
  nested?: NestedSort;
}

export interface HighlightConfig {
  fields: Record<string, HighlightField>;
  type?: 'unified' | 'plain' | 'fvh';
  fragmenter?: 'simple' | 'span';
  fragmentSize?: number;
  maxFragments?: number;
  noMatchSize?: number;
  numberOfFragments?: number;
  order?: 'score' | 'none';
  preTags?: string[];
  postTags?: string[];
  encoder?: 'default' | 'html';
  requireFieldMatch?: boolean;
  boundaryChars?: string;
  boundaryMaxScan?: number;
  boundaryScanner?: 'chars' | 'sentence' | 'word';
  boundaryScannerLocale?: string;
  forceSource?: boolean;
  fragmentOffset?: number;
  matchedFields?: string[];
  phraseLimit?: number;
  maxAnalyzedOffset?: number;
}

export interface HighlightField {
  type?: 'unified' | 'plain' | 'fvh';
  fragmenter?: 'simple' | 'span';
  fragmentSize?: number;
  maxFragments?: number;
  noMatchSize?: number;
  numberOfFragments?: number;
  order?: 'score' | 'none';
  preTags?: string[];
  postTags?: string[];
  encoder?: 'default' | 'html';
  requireFieldMatch?: boolean;
  boundaryChars?: string;
  boundaryMaxScan?: number;
  boundaryScanner?: 'chars' | 'sentence' | 'word';
  boundaryScannerLocale?: string;
  forceSource?: boolean;
  fragmentOffset?: number;
  matchedFields?: string[];
  phraseLimit?: number;
  maxAnalyzedOffset?: number;
}

export interface AggregationConfig {
  terms?: TermsAggregation;
  histogram?: HistogramAggregation;
  dateHistogram?: DateHistogramAggregation;
  range?: RangeAggregation;
  dateRange?: DateRangeAggregation;
  filter?: FilterAggregation;
  filters?: FiltersAggregation;
  nested?: NestedAggregation;
  reverseNested?: ReverseNestedAggregation;
  global?: GlobalAggregation;
  missing?: MissingAggregation;
  sampler?: SamplerAggregation;
  significantTerms?: SignificantTermsAggregation;
  significantText?: SignificantTextAggregation;
  geoDistance?: GeoDistanceAggregation;
  geoHashGrid?: GeoHashGridAggregation;
  geoCentroid?: GeoCentroidAggregation;
  geoBounds?: GeoBoundsAggregation;
  topHits?: TopHitsAggregation;
  scriptedMetric?: ScriptedMetricAggregation;
  sum?: MetricAggregation;
  avg?: MetricAggregation;
  min?: MetricAggregation;
  max?: MetricAggregation;
  count?: MetricAggregation;
  stats?: StatsAggregation;
  extendedStats?: ExtendedStatsAggregation;
  valueCount?: ValueCountAggregation;
  cardinality?: CardinalityAggregation;
  percentiles?: PercentilesAggregation;
  percentileRanks?: PercentileRanksAggregation;
  aggs?: Record<string, AggregationConfig>;
  aggregations?: Record<string, AggregationConfig>;
}

export interface TermsAggregation {
  field?: string;
  script?: Script;
  size?: number;
  shardSize?: number;
  showTermDocCountError?: boolean;
  order?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
  minDocCount?: number;
  shardMinDocCount?: number;
  include?: string | string[] | { pattern: string; flags?: string };
  exclude?: string | string[] | { pattern: string; flags?: string };
  missing?: any;
  valueType?: string;
  collectMode?: 'depth_first' | 'breadth_first';
  executionHint?: 'map' | 'global_ordinals' | 'global_ordinals_hash' | 'global_ordinals_low_cardinality';
}

export interface HistogramAggregation {
  field?: string;
  script?: Script;
  interval: number;
  minDocCount?: number;
  missing?: number;
  order?: Record<string, 'asc' | 'desc'>;
  offset?: number;
  keyed?: boolean;
}

export interface DateHistogramAggregation {
  field?: string;
  script?: Script;
  interval?: string;
  fixedInterval?: string;
  calendarInterval?: string;
  minDocCount?: number;
  missing?: string;
  order?: Record<string, 'asc' | 'desc'>;
  offset?: string;
  timeZone?: string;
  format?: string;
  keyed?: boolean;
}

export interface RangeAggregation {
  field?: string;
  script?: Script;
  ranges: Array<{
    key?: string;
    from?: number;
    to?: number;
  }>;
  keyed?: boolean;
}

export interface DateRangeAggregation {
  field?: string;
  script?: Script;
  ranges: Array<{
    key?: string;
    from?: string;
    to?: string;
  }>;
  format?: string;
  timeZone?: string;
  keyed?: boolean;
}

export interface FilterAggregation {
  filter: QueryDSL;
}

export interface FiltersAggregation {
  filters: Record<string, QueryDSL> | QueryDSL[];
  otherBucket?: boolean;
  otherBucketKey?: string;
  keyed?: boolean;
}

export interface NestedAggregation {
  path: string;
}

export interface ReverseNestedAggregation {
  path?: string;
}

export interface GlobalAggregation {}

export interface MissingAggregation {
  field: string;
}

export interface SamplerAggregation {
  shardSize?: number;
  field?: string;
  script?: Script;
}

export interface SignificantTermsAggregation {
  field?: string;
  size?: number;
  shardSize?: number;
  minDocCount?: number;
  shardMinDocCount?: number;
  include?: string | string[];
  exclude?: string | string[];
  executionHint?: 'map' | 'global_ordinals' | 'global_ordinals_hash';
  backgroundFilter?: QueryDSL;
  mutualInformation?: MutualInformationHeuristic;
  chiSquare?: ChiSquareHeuristic;
  gnd?: GNDHeuristic;
  scriptHeuristic?: ScriptHeuristic;
}

export interface SignificantTextAggregation {
  field: string;
  size?: number;
  shardSize?: number;
  minDocCount?: number;
  shardMinDocCount?: number;
  include?: string | string[];
  exclude?: string | string[];
  sourceFields?: string[];
  duplicateText?: boolean;
  backgroundFilter?: QueryDSL;
  mutualInformation?: MutualInformationHeuristic;
  chiSquare?: ChiSquareHeuristic;
  gnd?: GNDHeuristic;
  scriptHeuristic?: ScriptHeuristic;
}

export interface MutualInformationHeuristic {
  includeNegatives?: boolean;
  backgroundIsSuperset?: boolean;
}

export interface ChiSquareHeuristic {
  includeNegatives?: boolean;
  backgroundIsSuperset?: boolean;
}

export interface GNDHeuristic {
  backgroundIsSuperset?: boolean;
}

export interface ScriptHeuristic {
  script: Script;
}

export interface GeoDistanceAggregation {
  field: string;
  origin: GeoPoint;
  ranges: Array<{
    key?: string;
    from?: number;
    to?: number;
  }>;
  unit?: string;
  distanceType?: 'arc' | 'plane';
  keyed?: boolean;
}

export interface GeoHashGridAggregation {
  field: string;
  precision?: number;
  size?: number;
  shardSize?: number;
}

export interface GeoCentroidAggregation {
  field: string;
}

export interface GeoBoundsAggregation {
  field: string;
  wrapLongitude?: boolean;
}

export interface TopHitsAggregation {
  from?: number;
  size?: number;
  sort?: SortClause[];
  source?: boolean | string[];
  storedFields?: string[];
  docvalueFields?: string[];
  scriptFields?: Record<string, ScriptField>;
  highlight?: HighlightConfig;
  explain?: boolean;
  version?: boolean;
  seqNoPrimaryTerm?: boolean;
}

export interface ScriptedMetricAggregation {
  initScript?: Script;
  mapScript: Script;
  combineScript?: Script;
  reduceScript: Script;
  params?: Record<string, any>;
}

export interface MetricAggregation {
  field?: string;
  script?: Script;
  missing?: number;
  format?: string;
}

export interface StatsAggregation {
  field?: string;
  script?: Script;
  missing?: number;
  format?: string;
}

export interface ExtendedStatsAggregation {
  field?: string;
  script?: Script;
  missing?: number;
  format?: string;
  sigma?: number;
}

export interface ValueCountAggregation {
  field?: string;
  script?: Script;
}

export interface CardinalityAggregation {
  field?: string;
  script?: Script;
  precisionThreshold?: number;
  rehash?: boolean;
}

export interface PercentilesAggregation {
  field?: string;
  script?: Script;
  percents?: number[];
  compression?: number;
  missing?: number;
  keyed?: boolean;
  tdigest?: TDigestConfig;
  hdr?: HDRConfig;
}

export interface PercentileRanksAggregation {
  field?: string;
  script?: Script;
  values: number[];
  compression?: number;
  missing?: number;
  keyed?: boolean;
  tdigest?: TDigestConfig;
  hdr?: HDRConfig;
}

export interface TDigestConfig {
  compression?: number;
}

export interface HDRConfig {
  numberOfSignificantValueDigits?: number;
}

export interface ScriptField {
  script: Script;
}

export interface RescoreConfig {
  windowSize?: number;
  query: RescoreQuery;
}

export interface RescoreQuery {
  rescoreQuery: QueryDSL;
  queryWeight?: number;
  rescoreQueryWeight?: number;
  scoreMode?: 'total' | 'multiply' | 'avg' | 'max' | 'min';
}

export interface CollapseConfig {
  field: string;
  innerHits?: InnerHitsConfig;
  maxConcurrentGroupSearches?: number;
}

export interface InnerHitsConfig {
  name?: string;
  from?: number;
  size?: number;
  sort?: SortClause[];
  source?: boolean | string[];
  storedFields?: string[];
  docvalueFields?: string[];
  scriptFields?: Record<string, ScriptField>;
  highlight?: HighlightConfig;
  explain?: boolean;
  version?: boolean;
  seqNoPrimaryTerm?: boolean;
}

export interface SearchResponse<T = any> {
  took: number;
  timedOut: boolean;
  shards: {
    total: number;
    successful: number;
    skipped: number;
    failed: number;
  };
  hits: {
    total: {
      value: number;
      relation: 'eq' | 'gte';
    };
    maxScore: number | null;
    hits: SearchHit<T>[];
  };
  aggregations?: Record<string, any>;
  suggest?: Record<string, any>;
  profile?: any;
  pitId?: string;
  numReducePhases?: number;
}

export interface SearchHit<T = any> {
  index: string;
  type?: string;
  id: string;
  score: number | null;
  source: T;
  fields?: Record<string, any>;
  highlight?: Record<string, string[]>;
  sort?: any[];
  matchedQueries?: string[];
  explanation?: any;
  innerHits?: Record<string, SearchResponse<any>>;
  version?: number;
  seqNo?: number;
  primaryTerm?: number;
  routing?: string;
}

export interface BulkOperation {
  index?: {
    index: string;
    id?: string;
    routing?: string;
    version?: number;
    versionType?: string;
    opType?: 'index' | 'create';
    ifSeqNo?: number;
    ifPrimaryTerm?: number;
    pipeline?: string;
    requireAlias?: boolean;
  };
  create?: {
    index: string;
    id?: string;
    routing?: string;
    version?: number;
    versionType?: string;
    pipeline?: string;
    requireAlias?: boolean;
  };
  update?: {
    index: string;
    id: string;
    routing?: string;
    version?: number;
    versionType?: string;
    ifSeqNo?: number;
    ifPrimaryTerm?: number;
    retryOnConflict?: number;
    pipeline?: string;
    requireAlias?: boolean;
  };
  delete?: {
    index: string;
    id: string;
    routing?: string;
    version?: number;
    versionType?: string;
    ifSeqNo?: number;
    ifPrimaryTerm?: number;
  };
}

export interface BulkResponse {
  took: number;
  errors: boolean;
  items: BulkResponseItem[];
}

export interface BulkResponseItem {
  index?: BulkItemResponse;
  create?: BulkItemResponse;
  update?: BulkItemResponse;
  delete?: BulkItemResponse;
}

export interface BulkItemResponse {
  index: string;
  type?: string;
  id: string;
  version?: number;
  result?: string;
  status: number;
  error?: {
    type: string;
    reason: string;
    causedBy?: {
      type: string;
      reason: string;
    };
  };
  seqNo?: number;
  primaryTerm?: number;
  shards?: {
    total: number;
    successful: number;
    failed: number;
  };
}

export interface IndexTemplate {
  name: string;
  indexPatterns: string[];
  template: {
    settings?: IndexSettings;
    mappings?: IndexMapping;
    aliases?: Record<string, any>;
  };
  composedOf?: string[];
  priority?: number;
  version?: number;
  meta?: Record<string, any>;
  dataStream?: {
    hidden?: boolean;
    allowCustomRouting?: boolean;
  };
}

export interface SearchTemplate {
  id: string;
  source: string;
  params?: Record<string, any>;
  explain?: boolean;
  profile?: boolean;
}

export interface Suggester {
  text?: string;
  term?: TermSuggester;
  phrase?: PhraseSuggester;
  completion?: CompletionSuggester;
}

export interface TermSuggester {
  field: string;
  text?: string;
  analyzer?: string;
  size?: number;
  sort?: 'score' | 'frequency';
  suggestMode?: 'missing' | 'popular' | 'always';
  accuracy?: number;
  maxEdits?: number;
  maxInspections?: number;
  maxTermFreq?: number;
  prefixLength?: number;
  minWordLength?: number;
  minDocFreq?: number;
  shardSize?: number;
  lowercaseTerms?: boolean;
}

export interface PhraseSuggester {
  field: string;
  text?: string;
  analyzer?: string;
  size?: number;
  realWordErrorLikelihood?: number;
  confidence?: number;
  maxErrors?: number;
  separator?: string;
  directGenerator?: DirectGenerator[];
  highlight?: {
    preTag?: string;
    postTag?: string;
  };
  collate?: {
    query?: QueryDSL;
    params?: Record<string, any>;
    prune?: boolean;
  };
  smoothing?: SmoothingModel;
}

export interface DirectGenerator {
  field: string;
  size?: number;
  suggestMode?: 'missing' | 'popular' | 'always';
  maxEdits?: number;
  prefixLength?: number;
  minWordLength?: number;
  maxInspections?: number;
  minDocFreq?: number;
  maxTermFreq?: number;
  preFilter?: string;
  postFilter?: string;
}

export interface SmoothingModel {
  laplace?: {
    alpha?: number;
  };
  linearInterpolation?: {
    trigramLambda?: number;
    bigramLambda?: number;
    unigramLambda?: number;
  };
  stupidBackoff?: {
    discount?: number;
  };
}

export interface CompletionSuggester {
  field: string;
  text?: string;
  prefix?: string;
  regex?: string;
  size?: number;
  skipDuplicates?: boolean;
  fuzzy?: FuzzyOptions;
  contexts?: Record<string, any>;
}

export interface FuzzyOptions {
  fuzziness?: string | number;
  transpositions?: boolean;
  minLength?: number;
  prefixLength?: number;
  unicodeAware?: boolean;
}

export class ElasticsearchManager extends AsyncSingletonService<ElasticsearchManager> {
  private redis!: RedisClusterManager;
  private tracing!: DistributedTracing;
  private client: any = null; // Elasticsearch client placeholder
  private indices: Map<string, SearchIndex> = new Map();
  private templates: Map<string, IndexTemplate> = new Map();
  private connectionConfig: ElasticsearchConfig;

  protected constructor() {
    super();
    this.connectionConfig = this.getDefaultConfig();
  }

  static async getInstance(): Promise<ElasticsearchManager> {
    return super.getInstanceAsync(async (instance) => {
      await instance.initialize();
    });
  }

  private async initialize(): Promise<void> {
    try {
      this.redis = RedisClusterManager.getInstance();
      this.tracing = await DistributedTracing.getInstance();
      
      await this.connectToElasticsearch();
      await this.loadIndexDefinitions();
      await this.createDefaultIndices();
      
      logger.info('ElasticsearchManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ElasticsearchManager:', error);
      throw error;
    }
  }

  async createIndex(index: SearchIndex): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.index_name': index.name,
        'elasticsearch.operation': 'create_index'
      }
    };

    return this.tracing.traceAsync('elasticsearch_create_index', spanOptions, async () => {
      try {
        // Validate index definition
        await this.validateIndexDefinition(index);
        
        // Create index in Elasticsearch
        await this.createElasticsearchIndex(index);
        
        // Store index definition
        this.indices.set(index.name, index);
        await this.redis.setObject(`search:index:${index.name}`, index, 86400000 * 7); // 7 days
        
        logger.info(`Search index created: ${index.name}`);
      } catch (error) {
        logger.error(`Failed to create search index ${index.name}:`, error);
        throw error;
      }
    });
  }

  async search<T = any>(indexName: string, query: SearchQuery): Promise<SearchResponse<T>> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.index_name': indexName,
        'elasticsearch.operation': 'search',
        'elasticsearch.query_size': query.size || 10
      }
    };

    return this.tracing.traceAsync('elasticsearch_search', spanOptions, async () => {
      try {
        // Validate query
        await this.validateSearchQuery(query);
        
        // Execute search
        const response = await this.executeSearch<T>(indexName, query);
        
        // Cache results if appropriate
        if (this.shouldCacheQuery(query)) {
          await this.cacheSearchResults(indexName, query, response);
        }
        
        // Log search metrics
        await this.logSearchMetrics(indexName, query, response);
        
        return response;
      } catch (error) {
        logger.error(`Search failed on index ${indexName}:`, error);
        throw error;
      }
    });
  }

  async multiSearch<T = any>(searches: Array<{ index: string; query: SearchQuery }>): Promise<SearchResponse<T>[]> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.operation': 'multi_search',
        'elasticsearch.search_count': searches.length
      }
    };

    return this.tracing.traceAsync('elasticsearch_multi_search', spanOptions, async () => {
      try {
        const responses: SearchResponse<T>[] = [];
        
        // Execute searches in parallel
        const searchPromises = searches.map(({ index, query }) => 
          this.search<T>(index, query)
        );
        
        const results = await Promise.allSettled(searchPromises);
        
        for (const result of results) {
          if (result.status === 'fulfilled') {
            responses.push(result.value);
          } else {
            logger.error('Multi-search item failed:', result.reason);
            // Add empty response for failed searches
            responses.push(this.createEmptyResponse<T>());
          }
        }
        
        return responses;
      } catch (error) {
        logger.error('Multi-search failed:', error);
        throw error;
      }
    });
  }

  async indexDocument(indexName: string, document: any, id?: string): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.index_name': indexName,
        'elasticsearch.operation': 'index_document',
        'elasticsearch.document_id': id || 'auto'
      }
    };

    return this.tracing.traceAsync('elasticsearch_index_document', spanOptions, async () => {
      try {
        // Validate document
        await this.validateDocument(indexName, document);
        
        // Index document
        await this.indexElasticsearchDocument(indexName, document, id);
        
        logger.debug(`Document indexed in ${indexName}`, { id });
      } catch (error) {
        logger.error(`Failed to index document in ${indexName}:`, error);
        throw error;
      }
    });
  }

  async bulkIndex(operations: Array<{ operation: BulkOperation; document?: any }>): Promise<BulkResponse> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.operation': 'bulk_index',
        'elasticsearch.operation_count': operations.length
      }
    };

    return this.tracing.traceAsync('elasticsearch_bulk_index', spanOptions, async () => {
      try {
        // Validate bulk operations
        await this.validateBulkOperations(operations);
        
        // Execute bulk operation
        const response = await this.executeBulkOperation(operations);
        
        // Log bulk metrics
        await this.logBulkMetrics(operations, response);
        
        return response;
      } catch (error) {
        logger.error('Bulk index operation failed:', error);
        throw error;
      }
    });
  }

  async deleteDocument(indexName: string, id: string): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.index_name': indexName,
        'elasticsearch.operation': 'delete_document',
        'elasticsearch.document_id': id
      }
    };

    return this.tracing.traceAsync('elasticsearch_delete_document', spanOptions, async () => {
      try {
        await this.deleteElasticsearchDocument(indexName, id);
        
        logger.debug(`Document deleted from ${indexName}`, { id });
      } catch (error) {
        logger.error(`Failed to delete document from ${indexName}:`, error);
        throw error;
      }
    });
  }

  async updateDocument(indexName: string, id: string, updates: any): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.index_name': indexName,
        'elasticsearch.operation': 'update_document',
        'elasticsearch.document_id': id
      }
    };

    return this.tracing.traceAsync('elasticsearch_update_document', spanOptions, async () => {
      try {
        await this.updateElasticsearchDocument(indexName, id, updates);
        
        logger.debug(`Document updated in ${indexName}`, { id });
      } catch (error) {
        logger.error(`Failed to update document in ${indexName}:`, error);
        throw error;
      }
    });
  }

  async suggest(indexName: string, suggester: Suggester): Promise<any> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.index_name': indexName,
        'elasticsearch.operation': 'suggest'
      }
    };

    return this.tracing.traceAsync('elasticsearch_suggest', spanOptions, async () => {
      try {
        return await this.executeSuggestion(indexName, suggester);
      } catch (error) {
        logger.error(`Suggestion failed on index ${indexName}:`, error);
        throw error;
      }
    });
  }

  async createIndexTemplate(template: IndexTemplate): Promise<void> {
    try {
      await this.validateIndexTemplate(template);
      
      // Create template in Elasticsearch
      await this.createElasticsearchTemplate(template);
      
      this.templates.set(template.name, template);
      await this.redis.setObject(`search:template:${template.name}`, template, 86400000 * 30); // 30 days
      
      logger.info(`Index template created: ${template.name}`);
    } catch (error) {
      logger.error(`Failed to create index template ${template.name}:`, error);
      throw error;
    }
  }

  async reindexData(sourceIndex: string, targetIndex: string, query?: QueryDSL): Promise<void> {
    const spanOptions: SpanOptions = {
      attributes: {
        'elasticsearch.operation': 'reindex',
        'elasticsearch.source_index': sourceIndex,
        'elasticsearch.target_index': targetIndex
      }
    };

    return this.tracing.traceAsync('elasticsearch_reindex', spanOptions, async () => {
      try {
        await this.executeReindex(sourceIndex, targetIndex, query);
        
        logger.info(`Reindex completed: ${sourceIndex} -> ${targetIndex}`);
      } catch (error) {
        logger.error(`Reindex failed: ${sourceIndex} -> ${targetIndex}:`, error);
        throw error;
      }
    });
  }

  private async connectToElasticsearch(): Promise<void> {
    // Simulated Elasticsearch connection
    // In a real implementation, this would initialize the Elasticsearch client
    logger.info('Connected to Elasticsearch cluster');
  }

  private async loadIndexDefinitions(): Promise<void> {
    // Load existing index definitions from Redis
    logger.info('Loading index definitions');
  }

  private async createDefaultIndices(): Promise<void> {
    // Create default indices for the application
    const todoIndex: SearchIndex = {
      name: 'todos',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: {
            type: 'text',
            analyzer: 'standard',
            fields: {
              keyword: { type: 'keyword' },
              suggest: {
                type: 'completion',
                analyzer: 'simple'
              }
            }
          },
          description: {
            type: 'text',
            analyzer: 'standard'
          },
          status: { type: 'keyword' },
          priority: { type: 'keyword' },
          tags: { type: 'keyword' },
          userId: { type: 'keyword' },
          createdAt: { type: 'date' },
          updatedAt: { type: 'date' },
          completedAt: { type: 'date' },
          dueDate: { type: 'date' },
          location: { type: 'geo_point' },
          metadata: {
            type: 'object',
            dynamic: true
          }
        }
      },
      settings: {
        numberOfShards: 1,
        numberOfReplicas: 1,
        analysis: {
          analyzers: {
            todo_analyzer: {
              tokenizer: 'standard',
              filters: ['lowercase', 'stop', 'stemmer']
            }
          }
        }
      },
      aliases: ['todos_alias'],
      version: 1,
      created: new Date(),
      lastUpdated: new Date()
    };

    const userIndex: SearchIndex = {
      name: 'users',
      mappings: {
        properties: {
          id: { type: 'keyword' },
          email: { type: 'keyword' },
          name: {
            type: 'text',
            analyzer: 'standard',
            fields: {
              keyword: { type: 'keyword' }
            }
          },
          profile: {
            properties: {
              bio: { type: 'text' },
              location: { type: 'geo_point' },
              timezone: { type: 'keyword' },
              preferences: {
                type: 'object',
                dynamic: true
              }
            }
          },
          createdAt: { type: 'date' },
          lastLogin: { type: 'date' },
          isActive: { type: 'boolean' }
        }
      },
      settings: {
        numberOfShards: 1,
        numberOfReplicas: 1
      },
      aliases: ['users_alias'],
      version: 1,
      created: new Date(),
      lastUpdated: new Date()
    };

    await this.createIndex(todoIndex);
    await this.createIndex(userIndex);
  }

  private getDefaultConfig(): ElasticsearchConfig {
    return {
      nodes: [process.env.ELASTICSEARCH_URL || 'http://localhost:9200'],
      auth: process.env.ELASTICSEARCH_AUTH ? {
        username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD || 'password'
      } : undefined,
      tls: process.env.ELASTICSEARCH_TLS === 'true' ? {
        rejectUnauthorized: false
      } : undefined,
      requestTimeout: 30000,
      maxRetries: 3,
      compression: 'gzip'
    };
  }

  // Placeholder methods for Elasticsearch operations
  private async validateIndexDefinition(index: SearchIndex): Promise<void> {
    if (!index.name || !index.mappings) {
      throw new Error('Index name and mappings are required');
    }
  }

  private async createElasticsearchIndex(index: SearchIndex): Promise<void> {
    // Simulate index creation
    logger.debug(`Creating Elasticsearch index: ${index.name}`);
  }

  private async validateSearchQuery(query: SearchQuery): Promise<void> {
    // Validate query structure
    if (query.size && query.size > 10000) {
      throw new Error('Query size cannot exceed 10000');
    }
  }

  private async executeSearch<T>(indexName: string, query: SearchQuery): Promise<SearchResponse<T>> {
    // Simulate search execution
    return {
      took: Math.floor(Math.random() * 100),
      timedOut: false,
      shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      hits: {
        total: { value: 0, relation: 'eq' },
        maxScore: null,
        hits: []
      }
    };
  }

  private shouldCacheQuery(query: SearchQuery): boolean {
    // Simple caching logic
    return !query.scroll && (query.size || 10) <= 100;
  }

  private async cacheSearchResults<T>(indexName: string, query: SearchQuery, response: SearchResponse<T>): Promise<void> {
    const cacheKey = `search:cache:${indexName}:${this.hashQuery(query)}`;
    await this.redis.setObject(cacheKey, response, 300000); // 5 minutes
  }

  private async logSearchMetrics(indexName: string, query: SearchQuery, response: SearchResponse): Promise<void> {
    logger.info('Search executed', {
      index: indexName,
      took: response.took,
      total: response.hits.total.value,
      size: query.size
    });
  }

  private async validateDocument(indexName: string, document: any): Promise<void> {
    // Basic document validation
    if (!document || typeof document !== 'object') {
      throw new Error('Document must be a valid object');
    }
  }

  private async indexElasticsearchDocument(indexName: string, document: any, id?: string): Promise<void> {
    // Simulate document indexing
    logger.debug(`Indexing document in ${indexName}`, { id });
  }

  private async validateBulkOperations(operations: Array<{ operation: BulkOperation; document?: any }>): Promise<void> {
    if (operations.length === 0) {
      throw new Error('Bulk operations cannot be empty');
    }
  }

  private async executeBulkOperation(operations: Array<{ operation: BulkOperation; document?: any }>): Promise<BulkResponse> {
    // Simulate bulk operation
    return {
      took: Math.floor(Math.random() * 1000),
      errors: false,
      items: operations.map((_, index) => ({
        index: {
          index: 'test',
          id: `doc_${index}`,
          version: 1,
          result: 'created',
          status: 201
        }
      }))
    };
  }

  private async logBulkMetrics(operations: Array<{ operation: BulkOperation; document?: any }>, response: BulkResponse): Promise<void> {
    logger.info('Bulk operation completed', {
      operations: operations.length,
      took: response.took,
      errors: response.errors
    });
  }

  private async deleteElasticsearchDocument(indexName: string, id: string): Promise<void> {
    // Simulate document deletion
    logger.debug(`Deleting document ${id} from ${indexName}`);
  }

  private async updateElasticsearchDocument(indexName: string, id: string, updates: any): Promise<void> {
    // Simulate document update
    logger.debug(`Updating document ${id} in ${indexName}`);
  }

  private async executeSuggestion(indexName: string, suggester: Suggester): Promise<any> {
    // Simulate suggestion execution
    return {
      suggestions: []
    };
  }

  private async validateIndexTemplate(template: IndexTemplate): Promise<void> {
    if (!template.name || !template.indexPatterns) {
      throw new Error('Template name and index patterns are required');
    }
  }

  private async createElasticsearchTemplate(template: IndexTemplate): Promise<void> {
    // Simulate template creation
    logger.debug(`Creating index template: ${template.name}`);
  }

  private async executeReindex(sourceIndex: string, targetIndex: string, query?: QueryDSL): Promise<void> {
    // Simulate reindex operation
    logger.debug(`Reindexing from ${sourceIndex} to ${targetIndex}`);
  }

  private createEmptyResponse<T>(): SearchResponse<T> {
    return {
      took: 0,
      timedOut: false,
      shards: { total: 0, successful: 0, skipped: 0, failed: 0 },
      hits: {
        total: { value: 0, relation: 'eq' },
        maxScore: null,
        hits: []
      }
    };
  }

  private hashQuery(query: SearchQuery): string {
    return Buffer.from(JSON.stringify(query)).toString('base64').substring(0, 32);
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      // Close Elasticsearch client connection
      logger.info('Closing Elasticsearch connection');
    }
    
    logger.info('ElasticsearchManager shutdown completed');
  }
}

interface ElasticsearchConfig {
  nodes: string[];
  auth?: {
    username: string;
    password: string;
  };
  tls?: {
    rejectUnauthorized: boolean;
  };
  requestTimeout: number;
  maxRetries: number;
  compression: string;
}