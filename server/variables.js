IS_MAC = (process.platform === 'darwin');
IS_WINDOWS = (process.platform === 'win32');
IS_LINUX = (process.platform === 'linux');

Platform = {
  MAC: 'darwin',
  LINUX: 'linux',
  WINDOWS: 'win32'
};

LinuxFormat = { // Enum for different linux supported formats
  APPIMAGE: 'AppImage',
  DEB: 'deb',
  RPM: 'rpm'
};

IS_DEVELOPMENT = (process.env.NODE_ENV === 'development');
IS_PRODUCTION = (process.env.NODE_ENV !== 'development');

ROOT_URL = Meteor.settings.electron.rootUrl || process.env.ROOT_URL.slice(0, -1);
ROOT_PATH = IS_WINDOWS ? process.env.METEOR_SHELL_DIR.split(".meteor")[0] : process.env.PWD;
PARTIALS_ROOT_PATH = ROOT_PATH + '/public';

MimeTypes = {}
MimeTypes['.' + LinuxFormat.APPIMAGE] = 'application/octet-stream';

MULTIPART_BOUNDARY = '176b487255f68cc5'; // THIS_STRING_SEPARATES
CRLF = "\r\n";
