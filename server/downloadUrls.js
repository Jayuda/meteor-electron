const urlJoin = Npm.require('url-join');
const util = Npm.require('util');
const url = Npm.require('url');
const lodash = Npm.require('lodash');

// Global for tests.
parseMacDownloadUrl = function(electronSettings) {
  if (!electronSettings || !electronSettings.downloadUrls || !electronSettings.downloadUrls.darwin) return;

  return electronSettings.downloadUrls.darwin.replace('{{version}}', electronSettings.version);
};

// Global for tests.
parseWindowsDownloadUrls = function(electronSettings) {
  if (!electronSettings || !electronSettings.downloadUrls || !electronSettings.downloadUrls.win32) return;

  // The default value here is what `createBinaries` writes into the app's package.json, which is
  // what is read by `grunt-electron-installer` to name the installer.
  var appName = electronSettings.name || 'electron';

  var releasesUrl, installerUrl;
  var installerUrlIsVersioned = false;

  if (_.isString(electronSettings.downloadUrls.win32)) {
    if (electronSettings.downloadUrls.win32.indexOf('{{version}}') > -1) {
      console.error('Only the Windows installer URL may be versioned. Specify `downloadUrls.win32.installer`.');
      return;
    }
    releasesUrl = electronSettings.downloadUrls.win32;
    // 'AppSetup.exe' refers to the output of `grunt-electron-installer`.
    installerUrl = urlJoin(electronSettings.downloadUrls.win32, appName + 'Setup.exe');
  } else {
    releasesUrl = electronSettings.downloadUrls.win32.releases;
    if (releasesUrl.indexOf('{{version}}') > -1) {
      console.error('Only the Windows installer URL may be versioned.');
      return;
    }
    installerUrl = electronSettings.downloadUrls.win32.installer;
    if (installerUrl.indexOf('{{version}}') > -1) {
      installerUrl = installerUrl.replace('{{version}}', electronSettings.version);
      installerUrlIsVersioned = true;
    }
  }

  // Cachebust the installer URL if it's not versioned.
  // (The releases URL will also be cachebusted, but by `serveUpdateFeed` since we've got to append
  // the particular paths requested by the client).
  if (!installerUrlIsVersioned) {
    installerUrl = cachebustedUrl(installerUrl);
  }

  return {
    releases: releasesUrl,
    installer: installerUrl
  };
};

function cachebustedUrl(url) {
  var querySeparator = (url.indexOf('?') > -1) ? '&' : '?';
  return url + querySeparator + 'cb=' + Date.now();
}

/**
 * Parses the URLs provided in `settings` for the requested `platform` and all
 * architectures provided in build for that platform.
 *
 * @global
 * @param {Object} settings - Settings for Electron provided through `Meteor.settings.electron`.
 * @param {string} platform - The target platform (linux/darwin)
 * @return {string|string[]}
 * @since 0.1.4
 * @summary Parses the URLs for requested platform according to settings.
 * @version 1.0.0
 */
parseUrls = function (settings, platform) {
  if (!settings || !settings.downloadUrls || !settings.downloadUrls[platform]) {
    return;
  }

  const replaces = {
    name: lodash.chain(settings.name || APP_DEFAULT_NAME).toLower().deburr().kebabCase().value(),
    platform: platform,
    rootUrl: ROOT_URL,
    version: settings.version
  };

  const urls = settings.downloadUrls[platform];
  if (_.isEmpty(urls) || _.isUndefined(urls) || !(lodash.isPlainObject(urls) || lodash.isString(urls))) {
    console.warn(util.format('Cannot parse %s url(s) because of unexpected value provided', platform));
  } else {
    return replacePlaceholdersDeep(urls, replaces);
  }
}

/**
 * Recursively replaces placeholders present in the provided URL. The placeholders
 * `{{ext}}` (package/installer format) and `{{arch}}` introduce each a new depth
 * level, returning an object instead of a string, which has all the supported
 * values (all supported formats for a given platform, or all supported
 * architectures) as keys, and the parsed URL(s) as values.
 *
 * @param {string|Object} url - URL(s) to be parsed.
 * @param {Object} replaces - Object with placeholders as keys and their replacements as values.
 * @return {string|string[]} The absolute URL(s) with placeholders replaced.
 * @since 0.1.4
 * @summary Recursively replaces placeholders present in the provided URL(s).
 * @version 1.0.0
 */
function replacePlaceholdersDeep(urls, replaces) {
  var parsedUrls = {};
  if (lodash.isPlainObject(urls)) {
    lodash.each(urls, function(value, key) {
      parsedUrls[key] = replacePlaceholdersDeep(value, replaces);
    });
  } else if (_.isString(urls)) {
    // Unique placeholders
    Object.keys(replaces).forEach(function(token) {
      urls = urls.replace(new RegExp(util.format('{{%s}}', token), 'g'), replaces[token]);
    });

    // Check URL schema to prepend project root URL or not
    if (!/^https?:\/\//.test(urls)) {
      urls = url.resolve(replaces.rootUrl, urls);
    }

    // Process now the two placeholders that can generate trees: ext/arch
    const formatPlaceholder = '{{ext}}';
    const archPlaceholder = '{{arch}}';
    const hasFormatPlaceholder = (urls.indexOf(formatPlaceholder) !== -1);
    const hasArchPlaceholder = (urls.indexOf(archPlaceholder) !== -1);
    if (hasFormatPlaceholder && hasArchPlaceholder) {
      lodash.each(_.values(Arch), function(arch) {
        parsedUrls[arch] = {};
        lodash.each(_.values(LinuxFormat), function(format) {
          parsedUrls[arch][format] = urls.replace(archPlaceholder, arch).replace(formatPlaceholder, format);
        });
      });
    } else {
      const placeholder = hasFormatPlaceholder ? formatPlaceholder : archPlaceholder;
      const values = hasFormatPlaceholder ? _.values(LinuxFormat) : _.values(Arch);
      lodash.each(values, function(value) {
        parsedUrls[value] = urls.replace(placeholder, value);
      });
    }
  }
  return _.isEmpty(parsedUrls) ? urls : parsedUrls;
}

DOWNLOAD_URLS = {
  darwin: parseMacDownloadUrl(Meteor.settings.electron),
  linux: parseUrls(Meteor.settings.electron, Platform.LINUX),
  win32: parseWindowsDownloadUrls(Meteor.settings.electron)
};
