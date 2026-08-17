var should = require('should');
var pg = require('pg');
var adapter = require('../../lib/adapter');
var utils = require('../../lib/utils');

describe('native database types', function() {
  it('copies described UUID types without replacing Waterline logical types', function() {
    var schema = {
      user: {
        tableName: 'user',
        definition: {
          id: {type: 'string', primaryKey: true},
          name: {type: 'string'}
        }
      }
    };
    var described = utils.normalizeSchema([
      {Column: 'id', Type: 'uuid'},
      {Column: 'name', Type: 'text'}
    ]);

    var matched = utils.applyNativeTypes(schema, 'user', described);

    matched.should.eql(['id', 'name']);
    schema.user.definition.id.type.should.eql('string');
    schema.user.definition.id.nativeType.should.eql('uuid');
    schema.user.definition.name.nativeType.should.eql('text');
  });

  it('matches described types using physical columnName', function() {
    var schema = {
      account: {
        tableName: 'accounts',
        definition: {
          logicalId: {
            type: 'string',
            columnName: 'account_id'
          }
        }
      }
    };
    var described = {
      account_id: {type: 'uuid'}
    };

    var matched = utils.applyNativeTypes(schema, 'accounts', described);

    matched.should.eql(['account_id']);
    schema.account.definition.logicalId.nativeType.should.eql('uuid');
  });

  it('normalizes shorthand definitions before attaching native types', function() {
    var schema = {
      event: {
        tableName: 'event',
        definition: {
          id: 'string'
        }
      }
    };

    utils.applyNativeTypes(schema, 'event', {id: {type: 'uuid'}});

    schema.event.definition.id.should.eql({
      type: 'string',
      nativeType: 'uuid'
    });
  });

  it('does not modify definitions when described columns do not match', function() {
    var schema = {
      user: {
        tableName: 'user',
        definition: {
          id: {type: 'string'}
        }
      }
    };

    var matched = utils.applyNativeTypes(schema, 'user', {
      external_id: {type: 'uuid'}
    });

    matched.should.eql([]);
    should.not.exist(schema.user.definition.id.nativeType);
  });
});

describe('native database types query integration', function() {
  var originalPool;
  var capturedQuery;
  var capturedValues;
  var connectionName = 'native-types-query-test';
  var uuidV7 = '01890f9e-7b2c-7d3e-8f4a-123456789abc';

  before(function(done) {
    originalPool = pg.Pool;

    pg.Pool = function() {
      var client = {
        query: function(query, values, queryCb) {
          if(typeof values === 'function') {
            queryCb = values;
            values = undefined;
          }

          if(query.indexOf('pg_catalog.format_type') > -1) {
            return queryCb(null, {
              rows: [
                {
                  Table: 'public.uuid_records',
                  '#': 1,
                  Column: 'id',
                  Type: 'uuid',
                  NULL: 'NOT NULL',
                  Constraint: 'uuid_records_pkey',
                  C: 'p'
                },
                {
                  Table: 'public.uuid_records',
                  '#': 2,
                  Column: 'label',
                  Type: 'text',
                  NULL: ''
                }
              ]
            });
          }

          if(query.indexOf("s.relkind = 'S'") > -1 || query.indexOf("c.relkind IN ('i','')") > -1) {
            return queryCb(null, {rows: []});
          }

          capturedQuery = query;
          capturedValues = values;
          queryCb(null, {rows: []});
        }
      };

      return {
        on: function() {},
        connect: function(cb) {
          cb(null, client, function() {});
        },
        end: function(cb) {
          cb();
        }
      };
    };

    var definition = {
      id: {type: 'string', primaryKey: true},
      label: {type: 'string'}
    };
    var collection = {
      identity: 'uuid_record',
      tableName: 'uuid_records',
      connection: [connectionName],
      definition: definition,
      waterline: {
        schema: {
          uuid_record: {
            identity: 'uuid_record',
            tableName: 'uuid_records',
            connection: [connectionName],
            attributes: definition,
            definition: definition
          }
        }
      }
    };

    var collections = {uuid_records: collection};

    adapter.registerConnection({
      identity: connectionName,
      version: 1
    }, collections, done);
  });

  after(function(done) {
    adapter.teardown(connectionName, function() {
      pg.Pool = originalPool;
      done();
    });
  });

  it('builds UUID criteria from describe metadata instead of value shape', function(done) {
    adapter.find(connectionName, 'uuid_records', {
      where: {id: uuidV7},
      instructions: {}
    }, function(err) {
      should.not.exist(err);
      capturedQuery.should.containEql('WHERE "uuid_records"."id" = $1');
      capturedQuery.should.not.containEql('LOWER("uuid_records"."id")');
      capturedValues.should.eql([uuidV7]);
      done();
    });
  });
});
