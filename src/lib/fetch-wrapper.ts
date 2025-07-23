/**
 * Wrapper for ofetch to work around bundler issues
 */
import { $fetch as ofetchInstance, type FetchOptions } from 'ofetch';

export const $fetch = ofetchInstance;
export type { FetchOptions };