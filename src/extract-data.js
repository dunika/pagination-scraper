const { URL } = require('url');

const { isFunction, pickBy } = require('lodash');
const cheerio = require('cheerio');

const debug = require('./debug');

/**
* @param  {string | Function} nextPageSelector
* @param  {string} url
* @param  {Function} $
* @returns {Array}
*/

const getNextPageUrl = function getNextPageUrl(nextPageSelector, $, url, depth) {
  if (isFunction(nextPageSelector)) {
    return nextPageSelector({ $, depth, url });
  }

  const element = $(nextPageSelector);
  if (!element) {
    debug(`getNextPageUrl - no element found for nextPageSelector ${nextPageSelector}`);
    return null;
  }

  const href = element.attr('href');
  if (!href) {
    return null;
  }

  try {
    const nextPageUrl = new URL(href).href;
    debug(`getNextPageUrl - returned ${url}`);
    return nextPageUrl;
  } catch (error) {
    const { origin } = new URL(url);
    return `${origin}${href}`;
  }
};


const buildExtractText = selector => ({ $, parent }) => {
  const element = parent ? parent.find(selector) : $(selector);
  return element.text().trim();
};

const buildExtractData = (selectors) => {
  if (isFunction(selectors)) {
    return ({ html, ...rest }) => {
      const $ = cheerio.load(html);
      return selectors({ $, ...rest });
    };
  }

  return async ({ parent, $, ...rest }) => {
    try {
      const data = await Object.entries(selectors)
        .reduce(async (promise, [key, selector]) => {
          try {
            const prevResults = await promise || {};

            const extract = isFunction(selector) ? selector : buildExtractText(selector);

            const result = await extract({ $, parent, ...rest });
            return {
              ...prevResults,
              [key]: result,
            };
          } catch (error) {
            throw new Error(`${key} ${error.message}`);
          }
        }, Promise.resolve());
      return pickBy(data);
    } catch (error) {
      throw error;
    }
  };
};

module.exports.buildExtractData = buildExtractData;

/**
* @param  {Function} extract
* @param  {Function} terminate
* @returns {Function}
*/

const withTerminate = (extract, terminate) => {
  const state = { hasFinished: false, hasPrinted: false };
  return async function extractWithTerminate({ html, parent, url }) {
    const $ = cheerio.load(html);
    state.hasFinished = terminate(parent, $);
    if (state.hasFinished) {
      if (!state.hasPrinted) {
        debug('extractData - terminated');
        state.hasPrinted = true;
      }
      return null;
    }
    const data = await extract({ html, parent, url });
    return data;
  };
};

/**
* @param  {Object} options
* @param  {string | Function} options.dataSelector
* @param  {Function} [options.filter]
* @param  {string} options.html
* @param  {string | Function} options.nextPageSelector
* @param  {string} options.url
* @param  {string} options.parentSelector
* @param  {string | Function} [options.dataSelector]
* @param  {Function} [options.terminate]
* @returns {Array}
*/

module.exports.extractListingData = async function extractListingData({
  dataSelector,
  depth,
  filter,
  html,
  nextPageSelector,
  nextRequestOptions,
  parentSelector,
  terminate,
  url,
}) {
  const $ = cheerio.load(html);
  const elements = $(parentSelector).filter(!filter ? () => true : filter);

  if (!elements.length) {
    throw new Error(`No elements found matching ${parentSelector}`);
  }
  const extractor = buildExtractData(dataSelector);

  const extract = terminate ? withTerminate(extractor, terminate) : extractor;

  const parents = elements.map((index, element) => $(element)).get();

  const dataPromises = parents.map(parent => extract({
    html,
    $,
    parent,
    url,
  }));

  const data = (await Promise.all(dataPromises)).filter(Boolean);

  // If the length of the data does not match the length of the elements acted on then we can assume
  // that the terminate function returned true
  const nextPageUrl = data.length === elements.length ? getNextPageUrl(
    nextPageSelector,
    $,
    url,
    depth,
  ) : null;

  return {
    data,
    nextPageUrl,
    nextRequestOptions: nextRequestOptions && nextRequestOptions({ url, $, depth }),
  };
};
