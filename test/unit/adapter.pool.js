var should = require('should');
var pg = require('pg');
var adapter = require('../../lib/adapter');

describe('adapter pool configuration', function() {

  it('preserves ssl false for URL connections', function(done) {
    var OriginalPool = pg.Pool;
    var identity = 'url-ssl-false';
    var capturedConfig;

    pg.Pool = function(config) {
      capturedConfig = config;
      return new OriginalPool(config);
    };

    adapter.registerConnection({
      identity: identity,
      url: 'postgres://user:password@localhost:5432/database',
      ssl: false,
      poolSize: 10
    }, {}, function(err) {
      if(err) {
        return finish(err);
      }

      try {
        should(capturedConfig.ssl).equal(false);
      } catch (e) {
        return finish(e);
      }

      finish();
    });

    function finish(err) {
      adapter.teardown(identity, function() {
        pg.Pool = OriginalPool;
        done(err);
      });
    }
  });

  it('returns pool connection errors without throwing', function(done) {
    var OriginalPool = pg.Pool;
    var originalConsoleError = console.error;
    var identity = 'pool-connection-error';
    var expectedError = new Error('connection refused');

    expectedError.code = 'ECONNREFUSED';
    console.error = function() {};

    pg.Pool = function() {
      return {
        on: function() {},
        connect: function(cb) {
          cb(expectedError);
        },
        end: function(cb) {
          cb();
        }
      };
    };

    adapter.registerConnection({
      identity: identity,
      host: 'localhost',
      password: 'secret'
    }, {}, function(err) {
      if(err) {
        return finish(err);
      }

      try {
        adapter.query(identity, 'unused', 'SELECT 1', function(err) {
          try {
            should(err).equal(expectedError);
          } catch (e) {
            return finish(e);
          }

          finish();
        });
      } catch (e) {
        finish(e);
      }
    });

    function finish(err) {
      adapter.teardown(identity, function() {
        pg.Pool = OriginalPool;
        console.error = originalConsoleError;
        done(err);
      });
    }
  });

  it('discards and drains a connection when startup describe fails', function(done) {
    var OriginalPool = pg.Pool;
    var originalDescribe = adapter.describe;
    var identity = 'startup-describe-error';
    var expectedError = new Error('database temporarily unavailable');
    var pools = [];
    var retryDuringDrainError;
    var siblingDescribeCompleted = false;

    pg.Pool = function() {
      var pool = {
        ended: false,
        on: function() {},
        end: function(cb) {
          if(pool === pools[0]) {
            return setImmediate(function() {
              setImmediate(function() {
                adapter.registerConnection({ identity: identity }, {}, function(err) {
                  retryDuringDrainError = err;
                  pool.ended = true;
                  cb();
                });
              });
            });
          }

          pool.ended = true;
          cb();
        }
      };

      pools.push(pool);
      return pool;
    };

    adapter.describe = function(connectionName, collectionName, cb) {
      if(collectionName === 'widgets') {
        return cb(expectedError);
      }

      setImmediate(function() {
        siblingDescribeCompleted = true;
        cb();
      });
    };

    adapter.registerConnection({
      identity: identity
    }, { widgets: null, gadgets: null }, function(err) {
      var firstPoolEndedBeforeCallback = pools[0].ended;

      adapter.describe = originalDescribe;
      adapter.registerConnection({
        identity: identity
      }, {}, function(retryErr) {
        try {
          should(err).equal(expectedError);
          should(firstPoolEndedBeforeCallback).equal(true);
          should.exist(retryDuringDrainError);
          should(siblingDescribeCompleted).equal(true);
          should.not.exist(retryErr);
          should(pools.length).equal(2);
        } catch (e) {
          return finish(e);
        }

        finish();
      });
    });

    function finish(err) {
      adapter.describe = originalDescribe;
      adapter.teardown(identity, function() {
        pg.Pool = OriginalPool;
        done(err);
      });
    }
  });

});
