/**
 * Boolean constants to check whether the current Meteor.js host matches a
 * specific platform (system) or not.
 *
 * @constant {boolean}
 * @global
 * @since 0.1.4
 * @readonly
 * @version 1.0.0
 */
IS_MAC = (process.platform === 'darwin');
IS_WINDOWS = (process.platform === 'win32');
IS_LINUX = (process.platform === 'linux');

/**
 * Constants to check if the current Meteor.js host matches a specific platform (system).
 *
 * @constant {boolean}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
IS_DEVELOPMENT = _.has(Meteor, 'isDevelopment') ? Meteor.isDevelopment : (process.env.NODE_ENV === 'development');
IS_PRODUCTION = _.has(Meteor, 'isProduction') ? Meteor.isProduction : (process.env.NODE_ENV !== 'development');

/**
 * Constants for urls/paths.
 *
 * @constant {string}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
ROOT_URL = Meteor.settings.electron.rootUrl || process.env.ROOT_URL.slice(0, -1);
ROOT_PATH = IS_WINDOWS ? process.env.METEOR_SHELL_DIR.split(".meteor")[0] : process.env.PWD;

/**
 * Enum for the different platforms which Meteor.js (Node.js) may work on.
 * Mostly used for checking the build target platform.
 *
 * @enum {string}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
Platform = {
  MAC: 'darwin',
  LINUX: 'linux',
  WINDOWS: 'win32'
};


/**
 * Enum for the different architectures.
 *
 * @enum {string}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
Arch = {
  ia32: 'ia32',
  x64: 'x64'
};

/**
 * Electron-related constants.
 *
 * @constant {string}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
APP_DEFAULT_NAME = 'Electron';

/**
 * Enum for the different formats supported at present for Linux.
 *
 * @enum {string}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
LinuxFormat = {
  APPIMAGE: 'AppImage',
  DEB: 'deb',
  RPM: 'rpm'
};

/**
 * Mime types. Used with multipart/byteranges requests.
 *
 * @enum
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
MimeTypes = {}
MimeTypes['.' + LinuxFormat.APPIMAGE.toLowerCase()] = 'application/octet-stream';

/**
 * Constants for multipart/byteranges requests.
 *
 * @constant {string}
 * @global
 * @readonly
 * @since 0.1.4
 * @version 1.0.0
 */
MULTIPART_ROOT_PATH = ROOT_PATH + '/public';
MULTIPART_BOUNDARY = Npm.require('crypto').randomBytes(32).toString('hex');
CRLF = "\r\n";
