var Dockerode = require('dockerode');
var async = require('async');
var exec = require('exec');
var path = require('path');
var fs = require('fs');

Docker = {};

Docker.hostIp = null;
Docker.hostPort = '2376';

Docker.setHost = function (host) {
  Docker.hostIp = host;
};

Docker.client = function () {
  var certDir = path.join(process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'], '.boot2docker/certs/boot2docker-vm');
  if (!fs.existsSync(certDir)) {
    return null;
  }
  return new Dockerode({
    protocol: 'https',
    host: Docker.hostIp,
    port: Docker.hostPort,
    ca: fs.readFileSync(path.join(certDir, 'ca.pem')),
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    key: fs.readFileSync(path.join(certDir, 'key.pem'))
  });
};

Docker.removeContainer = function (containerId, callback) {
  var container = Docker.client().getContainer(containerId);
  container.kill(function (err) {
    if (err) { callback(err); return; }
    container.remove({v:1}, function (err) {
      if (err) { callback(err); return; }
      console.log('Deleted container: ' + containerId);
      callback(null);
    });
  });
};

Docker.listContainers = function (callback) {
  Docker.client().listContainers({all: true}, function (err, containers) {
    if (err) {
      callback(err, null);
    } else {
      var cbList = _.map(containers, function (container) {
        return function (cb) {
          Docker.getContainerData(container.Id, function (err, data) {
            if (err) {
              cb(err, null);
            } else {
              cb(null, data);
            }
          });
        };
      });
      async.parallel(cbList, function (err, results) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, results);
        }
      });
    }
  });
};

Docker.getContainerData = function (containerId, callback) {
  var container = Docker.client().getContainer(containerId);
  container.inspect(function (err, data) {
    if (err) {
      callback(err, null);
      return;
    } else {
      if (data.Config && data.Config.Volumes) {
        data.Config.Volumes = convertVolumeObjToArray(data.Config.Volumes);
      }
      if (data.Volumes) {
        data.Volumes = convertVolumeObjToArray(data.Volumes);
      }
      if (data.VolumesRW) {
        data.VolumesRW = convertVolumeObjToArray(data.VolumesRW);
      }
      callback(null, data);
      return;
    }
  });
};

Docker.runContainer = function (app, image, callback) {
  var envParam = [];
  _.each(_.keys(app.config), function (key) {
    var builtStr = key + '=' + app.config[key];
    envParam.push(builtStr);
  });
  console.log(envParam);
  Docker.client().createContainer({
    Image: image.docker.Id,
    Tty: false,
    Env: envParam,
    Hostname: app.name,
    name: app.name
  }, function (err, container) {
    if (err) { callback(err, null); return; }
    console.log('Created container: ' + container.id);
    // Bind volumes
    var binds = [];
    if (image.docker.Config.Volumes && image.docker.Config.Volumes.length > 0) {
      _.each(image.docker.Config.Volumes, function (vol) {
        binds.push('/var/lib/docker/binds/' + app.name + vol.Path + ':' + vol.Path);
      });
    }
    // Start the container
    container.start({
      PublishAllPorts: true,
      Binds: binds
    }, function (err) {
      if (err) { callback(err, null); return; }
      console.log('Started container: ' + container.id);
      callback(null, container);
    });
  });
};

Docker.startContainer = function (containerId, callback) {
  var container = Docker.client().getContainer(containerId);
  container.start(function (err) {
    if (err) {
      console.log(err);
      callback(err);
      return;
    }
    console.log('Started container: ' + containerId);
    callback(null);
  });
};

Docker.stopContainer = function (containerId, callback) {
  var container = Docker.client().getContainer(containerId);
  container.stop(function (err) {
    if (err) {
      console.log(err);
      callback(err);
      return;
    }
    console.log('Stopped container: ' + containerId);
    callback(null);
  });
};

Docker.restartContainer = function (containerId, callback) {
  var container = Docker.client().getContainer(containerId);
  container.restart(function (err) {
    if (err) {
      console.log(err);
      callback(err);
      return;
    }
    console.log('Restarted container: ' + containerId);
    callback(null);
  });
};

var convertVolumeObjToArray = function (obj) {
  var result = [];
  if (obj !== null && typeof obj === 'object') {
    _.each(_.keys(obj), function (key) {
      var volumeObj = {};
      volumeObj.Path = key;
      volumeObj.Value = obj[key];
      result.push(volumeObj);
    });
  }
  return result;
};

Docker.getImageData = function (imageId, callback) {
  Docker.client().listImages({all: false}, function (err, images) {
    if (err) {
      callback(err, null);
    } else {
      var dockerImage = _.find(images, function (image) {
        return image.Id === imageId;
      });
      var image = Docker.client().getImage(imageId);
      image.inspect(function (err, data) {
        if (err) {
          callback(err, null);
        } else {
          if (data.Config && data.Config.Volumes) {
            data.Config.Volumes = convertVolumeObjToArray(data.Config.Volumes);
          }
          if (data.ContainerConfig && data.ContainerConfig.Volumes) {
            data.ContainerConfig.Volumes = convertVolumeObjToArray(data.ContainerConfig.Volumes);
          }
          if (!dockerImage) {
            callback(null, data);
          } else {
            callback(null, _.extend(dockerImage, data));
          }
        }
      });
    }
  });
};

Docker.listImages = function (callback) {
  Docker.client().listImages({all: false}, function (err, images) {
    if (err) {
      callback(err, null);
    } else {
      var cbList = _.map(images, function (image) {
        return function (cb) {
          Docker.getImageData(image.Id, function (err, data) {
            if (err) {
              cb(err, null);
            } else {
              cb(null, data);
            }
          });
        };
      });
      async.parallel(cbList, function (err, results) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, results);
        }
      });
    }
  });
};

Docker.removeImage = function (imageId, callback) {
  var image = Docker.client().getImage(imageId);
  image.remove({force: true}, function (err) {
    if (err) { callback(err); return; }
    console.log('Deleted image: ' + imageId);
    callback(null);
  });
};

Docker.removeBindFolder = function (name, callback) {
  exec(Boot2Docker.command() + ' ssh "sudo rm -rf /var/lib/docker/binds/' + name + '"', function (err, stdout) {
    callback(err, stdout);
  });
};
