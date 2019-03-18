import {Model, field} from '@storable/model';
import {callWithOneOrMany} from '@storable/util';
import cuid from 'cuid';

class BaseDocument extends Model {
  @field('string', {serializedName: '_id'}) id = this.constructor.generateId();

  async afterLoad() {
    await this.forEachSubdocument(async document => await document.afterLoad());
  }

  async beforeSave() {
    await this.forEachSubdocument(async document => await document.beforeSave());
  }

  async afterSave() {
    this.markAsNotNew();
    await this.forEachSubdocument(async document => await document.afterSave());
  }

  async beforeDelete() {
    await this.forEachSubdocument(async document => await document.beforeDelete());
  }

  async afterDelete() {
    await this.forEachSubdocument(async document => await document.afterDelete());
  }

  async forEachSubdocument(func) {
    const subdocuments = [];
    this.constructor.forEachField(field => {
      const value = this[field.name];
      if (value !== undefined) {
        callWithOneOrMany(value, value => {
          if (value?.isOfType && value.isOfType('Subdocument')) {
            subdocuments.push(value);
          }
        });
      }
    });

    for (const subdocument of subdocuments) {
      await func(subdocument);
    }
  }

  static generateId() {
    return cuid();
  }
}

export class Document extends BaseDocument {
  static async get(id, {return: returnFields, throwIfNotFound = true} = {}) {
    validateId(id);

    const store = this._getStore();
    let options;
    if (returnFields !== undefined) {
      options = {return: returnFields}; // TODO: Take into account the 'serializedName' field option
    }
    const serializedDocument = await store.get({_type: this.getName(), _id: id}, options);
    if (!serializedDocument) {
      if (throwIfNotFound) {
        throw new Error(`Document not found (model: '${this.getName()}', id: '${id}')`);
      }
      return undefined;
    }

    const document = this.deserialize(serializedDocument);

    await document.afterLoad();

    return document;
  }

  async save() {
    await this.beforeSave();

    const store = this.constructor._getStore();
    const serializedDocument = this.serialize({
      filter: (model, field) => {
        return model.fieldIsChanged(field);
      }
    });
    await store.set(serializedDocument);
    this.commit();

    await this.afterSave();
  }

  async delete() {
    await this.beforeDelete();

    const store = this.constructor._getStore();
    const serializedDocument = this._serializeId();
    await store.delete(serializedDocument);

    await this.afterDelete();
  }

  serialize({filter, _level = 0} = {}) {
    if (_level > 0) {
      // It is a referenced document
      return this._serializeReference();
    }
    if (filter) {
      const originalFilter = filter;
      filter = (model, field) => {
        if (field.name === 'id') {
          // The 'id' field cannot be filtered out
          return true;
        }
        return originalFilter(model, field);
      };
    }
    return super.serialize({filter, _level});
  }

  _serializeId() {
    return {_type: this.constructor.getName(), _id: this.id};
  }

  _serializeReference() {
    return {...this._serializeId(), _ref: true};
  }

  static canBeSubmodel() {
    return false;
  }

  isOfType(name) {
    return name === 'Document' ? true : super.isOfType(name); // Optimization
  }

  static _getStore() {
    const registry = this._getRegistry();
    if (!registry.store) {
      throw new Error(`Store not found (model: ${this.name})`);
    }
    return registry.store;
  }
}

export class Subdocument extends BaseDocument {
  isOfType(name) {
    return name === 'Subdocument' ? true : super.isOfType(name); // Optimization
  }
}

function validateId(id) {
  if (typeof id !== 'string') {
    throw new Error(`'id' must be a string (provided: ${typeof id})`);
  }
  if (id === '') {
    throw new Error(`'id' cannot be empty`);
  }
}
