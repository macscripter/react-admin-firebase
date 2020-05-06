import * as firebase from "firebase/app";
import rp from "request-promise";
import "firebase/firestore";

import {
  CREATE,
  DELETE,
  DELETE_MANY,
  GET_LIST,
  GET_MANY,
  GET_MANY_REFERENCE,
  GET_ONE,
  UPDATE,
  UPDATE_MANY
} from "react-admin";
import { Observable } from "rxjs";

export interface IResource {
  path: string;
  collection: firebase.firestore.CollectionReference;
  observable: Observable<{}>;
  list: Array<{}>;
}

// UTILS

function isEmptyObj(obj) {
  return JSON.stringify(obj) == "{}";
}

function log(description: string, obj: {}) {
  if (ISDEBUG) {
    console.log(description, obj);
  }
}

var ISDEBUG = false;

class FirebaseClient {
  private db: firebase.firestore.Firestore;
  private app: firebase.app.App;
  private resources: {
    [resourceName: string]: IResource;
  } = {};

  constructor(firebaseConfig: {}) {
    if (!firebase.apps.length) {
      this.app = firebase.initializeApp(firebaseConfig);
    } else {
      this.app = firebase.app();
    }
    this.db = this.app.firestore();
  }

  private parseFireStoreDocument(
    doc: firebase.firestore.QueryDocumentSnapshot
  ): {} {
    const data = doc.data();
    Object.keys(data).forEach(key => {
      const value = data[key];
      if (value && value.toDate && value.toDate instanceof Function) {
        data[key] = value.toDate().toISOString();
      }
    });
    // React Admin requires an id field on every document,
    // So we can just using the firestore document id
    return { id: doc.id, ...data };
  }

  public async initPath(path: string): Promise<void> {
    return new Promise(resolve => {
      const hasBeenInited = this.resources[path];
      if (hasBeenInited) {
        return resolve();
      }
      const collection = this.db.collection(path);
      const observable = this.getCollectionObservable(collection);
      observable.subscribe(
        (querySnapshot: firebase.firestore.QuerySnapshot) => {
          const newList = querySnapshot.docs.map(
            (doc: firebase.firestore.QueryDocumentSnapshot) =>
              this.parseFireStoreDocument(doc)
          );
          this.setList(newList, path);
          // The data has been set, so resolve the promise
          resolve();
        }
      );
      const list: Array<{}> = [];
      const r: IResource = {
        collection,
        list,
        observable,
        path
      };
      this.resources[path] = r;
      log("initPath", { path, r, "this.resources": this.resources });
    });
  }

  private async getFirebaseSource(myResource: string): Promise<Array<{}>> {
    return new Promise((resolve, reject) => {
      var sourceRef = firebase.firestore().collection(myResource);
      var query = sourceRef
        //.where("published", "==", true)
        .get()
        .then(snapshot => {
          if (snapshot.empty) {
            resolve([]);
          }
          let result = [];
          snapshot.forEach(doc => {
            result.push({ id: doc.id, ...doc.data() });
          });
          resolve(result);
        })
        .catch(err => {
          reject();
        });
    });
  }

  private async insertDataInFirebaseWithId(
    resourceName: string,
    params: IParamsCreate
  ): Promise<{ id }> {
    return new Promise((resolve, reject) => {
      const myId = params.data["myId"].toLowerCase();
      var sourceRef = firebase
        .firestore()
        .collection(resourceName)
        .doc(myId);
      delete params.data["myId"];
      var query = sourceRef
        .set({
          ...params.data,
          createdate: firebase.firestore.FieldValue.serverTimestamp(),
          lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
          createdByUid: firebase.auth().currentUser.uid,
          updatedByUid: firebase.auth().currentUser.uid,
          createdByEmail: firebase.auth().currentUser.email,
          updatedByEmail: firebase.auth().currentUser.email
        })
        .then(() => {
          resolve({ id: myId });
        })
        .catch(err => {
          reject();
        });
    });
  }

  private async addDataInFirebase(
    resourceName: string,
    params: IParamsCreate
  ): Promise<{ id }> {
    return new Promise((resolve, reject) => {
      var sourceRef = firebase.firestore().collection(resourceName);
      var query = sourceRef
        .add({
          ...params.data,
          createdate: firebase.firestore.FieldValue.serverTimestamp(),
          lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
          createdByUid: firebase.auth().currentUser.uid,
          updatedByUid: firebase.auth().currentUser.uid,
          createdByEmail: firebase.auth().currentUser.email,
          updatedByEmail: firebase.auth().currentUser.email
        })
        .then(ref => {
          resolve({ id: ref.id });
        })
        .catch(err => {
          reject();
        });
    });
  }

  private async updateDataInFirebase(
    resourceName: string,
    params: IParamsCreate,
    myId: string
  ): Promise<{ id }> {
    return new Promise((resolve, reject) => {
      var sourceRef = firebase
        .firestore()
        .collection(resourceName)
        .doc(myId);
      var query = sourceRef
        .update({
          ...params.data,
          lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByUid: firebase.auth().currentUser.uid,
          updatedByEMail: firebase.auth().currentUser.email
        })
        .then(ref => {
          resolve({ id: myId });
        })
        .catch(err => {
          reject();
        });
    });
  }

  public async apiGetList(
    resourceName: string,
    params: IParamsGetList
  ): Promise<IResponseGetList> {
    const r = await this.tryGetResource(resourceName);
    const data = r.list;
    const { field = "id", order = "asc" } = params.sort || {};
    this.sortArray(
      data,
      field,
      order.toString().toLowerCase() == "asc" ? "asc" : "desc"
    );
    log("apiGetList", { resourceName, resource: r, params });

    let filteredData = this.filterArray(data, params.filter || {});

    if (
      [
        "analysisActionsUsers",
        "analysisDataUsers",
        "analysisProductionUsers",
        "analysisSystemUsers",
        "analysisTeamUsers"
      ].indexOf(resourceName) !== -1
    ) {
      const filteredDataUsers = this.filterArray(data, params.filter || {});
      const questionsInConnectedUser = filteredDataUsers.filter(
        (item: {published: boolean, createdByUid: string }) => {
          if (item.createdByUid === firebase.auth().currentUser.uid && item.published === true) {
            return true;
          } else {
            return false;
          }
        }
      );
      const datar = await this.getFirebaseSource(
        resourceName.replace("Users", "")
      );
      const questionsInTemplate = this.filterArray(datar, params.filter || {}).filter(
        (item: {published: boolean}) => {
          if (item.published === true) {
            return true;
          } else {
            return false;
          }
        }
      );
      const questions2AddFromTemplate = questionsInTemplate
        .filter((item: {id: string }) => {
          const filteredInTemplate = questionsInConnectedUser.filter(
            (val: { questionId: string }) => {
              if (val.questionId === item.id) {
                return true;
              } else {
                return false;
              }
            }
          );
          if (filteredInTemplate.length < 1) {
            return true;
          } else {
            return false;
          }
        })
        .map((doc: firebase.firestore.QueryDocumentSnapshot) => {
          return { ...doc, questionId: doc.id };
        });
      filteredData = [
        ...questionsInConnectedUser,
        ...questions2AddFromTemplate
      ];
    }

    const { page = 1, perPage = -1 } = params.pagination || {};
    const pageStart = (page - 1) * perPage;
    const pageEnd = pageStart + perPage;
    const dataPage = params.pagination
      ? filteredData.slice(pageStart, pageEnd)
      : filteredData;
    const total = filteredData.length;
    return {
      data: dataPage,
      total
    };
  }

  public async apiGetOne(
    resourceName: string,
    params: IParamsGetOne
  ): Promise<IResponseGetOne> {
    let data;
    if (
      [
        "analysisActionsUsers",
        "analysisDataUsers",
        "analysisProductionUsers",
        "analysisSystemUsers",
        "analysisTeamUsers"
      ].indexOf(resourceName) !== -1
    ) {
      let r = await this.getFirebaseSource(resourceName);
      data = r.filter((val: { id: string }) => val.id === params.id);
      if (data.length < 1) {
        r = await this.getFirebaseSource(resourceName.replace("Users", ""));
        data = r
          .filter((val: { id: string }) => val.id === params.id)
          .map((doc: firebase.firestore.QueryDocumentSnapshot) => {
            return { ...doc, questionId: doc.id };
          });
      }
    } else if (resourceName === "users" && !params.id) {
      let rr = await this.tryGetResource(resourceName);
      data = rr.list.filter(
        (val: { id: string }) => val.id === firebase.auth().currentUser.uid
      );
    } else if (resourceName === "profile") {
      let rr = await this.getFirebaseSource("users");
      let prevData = rr.filter(
        (val: { id: string }) => val.id === firebase.auth().currentUser.uid
      );
      data = [];
      prevData.forEach(doc => {
        data.push({ ...doc, id: params.id });
      });
    } else {
      let rr = await this.tryGetResource(resourceName);
      data = rr.list.filter((val: { id: string }) => val.id === params.id);
    }
    if (data.length < 1) {
      throw new Error(
        "react-admin-firebase: No id found matching: " + params.id
      );
    }
    return { data: data.pop() };
  }

  public async apiCreate(
    resourceName: string,
    params: IParamsCreate
  ): Promise<IResponseCreate> {
    const r = await this.tryGetResource(resourceName);
    log("apiCreate", { resourceName, resource: r, params });
    const doc = params.data["myId"]
      ? await this.insertDataInFirebaseWithId(resourceName, params)
      : await r.collection.add({
          ...params.data,
          createdate: firebase.firestore.FieldValue.serverTimestamp(),
          lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
          createdByUid: firebase.auth().currentUser.uid,
          updatedByUid: firebase.auth().currentUser.uid,
          createdByEmail: firebase.auth().currentUser.email,
          updatedByEmail: firebase.auth().currentUser.email
        });
    return {
      data: {
        ...params.data,
        id: doc.id
      }
    };
  }

  public async apiUpdate(
    resourceName: string,
    params: IParamsUpdate
  ): Promise<IResponseUpdate> {
	  
	let options = {
    method: 'POST',
    uri: 'https://us-central1-bandwitt-techreach.cloudfunctions.net/widgets/calculateScoring',
    body: {
        source: resourceName,
		id: firebase.auth().currentUser.uid
		
    },
    json: true // Automatically stringifies the body to JSON
	};  
    const id = params.id;
    delete params.data.id;
    let r;
    if (resourceName === "profile") {
      r = {};
      r.list = await this.getFirebaseSource("users");
    } else {
      r = await this.tryGetResource(resourceName);
    }
    log("apiUpdate", { resourceName, resource: r, params });

    var data2Work = {
      ...params.data,
      lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByUid: firebase.auth().currentUser.uid,
      updatedByEMail: firebase.auth().currentUser.email
    };

    if (
      [
        "analysisActionsUsers",
        "analysisDataUsers",
        "analysisProductionUsers",
        "analysisSystemUsers",
        "analysisTeamUsers"
      ].indexOf(resourceName) !== -1
    ) {
      const data = r.list.filter((val: { id: string }) => val.id === id);
      if (data.length < 1) {
        params.data["questionId"] = id;
        const myDataAdded = await this.addDataInFirebase(resourceName, params);
		const updateScoring = await rp(options);
        return {
          data: {
            ...params.data,
            id
          }
        };
      } else {
        const myDataIUpdated = await this.updateDataInFirebase(
          resourceName,
          params,
          id
        );
		const updateScoring = await rp(options);
        return {
          data: {
            ...params.data,
            id
          }
        };
      }
    } else {
      if (resourceName === "profile") {
        const myDataIUpdated = await this.updateDataInFirebase(
          "users",
          params,
          firebase.auth().currentUser.uid
        );
      }
	  else if(resourceName === "users") {
		options.body.id = id;
		const updateScoring = await rp(options);
		const resUpdateDefault = await r.collection.doc(id).update(data2Work);		
	  }

	  else {
        const resUpdateDefault = await r.collection.doc(id).update(data2Work);
      }
      return {
        data: {
          ...data2Work,
          id
        }
      };
    }
  }

  public async apiUpdateMany(
    resourceName: string,
    params: IParamsUpdateMany
  ): Promise<IResponseUpdateMany> {
    delete params.data.id;
    const r = await this.tryGetResource(resourceName);
    log("apiUpdateMany", { resourceName, resource: r, params });
    const returnData = [];
    for (const id of params.ids) {
      r.collection.doc(id).update({
        ...params.data,
        lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByUid: firebase.auth().currentUser.uid,
        updatedByEmail: firebase.auth().currentUser.email
      });
      returnData.push({
        ...params.data,
        id
      });
      if (
        [
          "analysisActionsUsers",
          "analysisDataUsers",
          "analysisProductionUsers",
          "analysisSystemUsers",
          "analysisTeamUsers"
        ].indexOf(resourceName) !== -1
      ) {
        const data = r.list.filter((val: { id: string }) => val.id === id);
        if (data.length < 1) {
          firebase
            .firestore()
            .collection(resourceName)
            .add({
              ...params.data,
              createdate: firebase.firestore.FieldValue.serverTimestamp(),
              createdByUid: firebase.auth().currentUser.uid,
              createdByEmail: firebase.auth().currentUser.email
            });
        } else {
          firebase
            .firestore()
            .collection(resourceName)
            .doc(id)
            .update({
              ...params.data,
              lastupdate: firebase.firestore.FieldValue.serverTimestamp(),
              updatedByUid: firebase.auth().currentUser.uid,
              updatedByEmail: firebase.auth().currentUser.email
            });
        }
      }
    }
    return {
      data: returnData
    };
  }

  public async apiDelete(
    resourceName: string,
    params: IParamsDelete
  ): Promise<IResponseDelete> {
    const r = await this.tryGetResource(resourceName);
    log("apiDelete", { resourceName, resource: r, params });
    r.collection.doc(params.id).delete();
    return {
      data: params.previousData
    };
  }

  public async apiDeleteMany(
    resourceName: string,
    params: IParamsDeleteMany
  ): Promise<IResponseDeleteMany> {
    const r = await this.tryGetResource(resourceName);
    log("apiDeleteMany", { resourceName, resource: r, params });
    const returnData = [];
    const batch = this.db.batch();
    for (const id of params.ids) {
      batch.delete(r.collection.doc(id));
      returnData.push({ id });
    }
    batch.commit();
    return { data: returnData };
  }

  public async apiGetMany(
    resourceName: string,
    params: IParamsGetMany
  ): Promise<IResponseGetMany> {
    let r;
    const ids = new Set(params.ids);
    let matches;

    if (
      [
        "analysisActionsUsers",
        "analysisDataUsers",
        "analysisProductionUsers",
        "analysisSystemUsers",
        "analysisTeamUsers"
      ].indexOf(resourceName) !== -1
    ) {
      r = await this.getFirebaseSource(resourceName);
      matches = r.filter(item => ids.has(item["id"]));
      if (matches.length < 1) {
        r = await this.getFirebaseSource(resourceName.replace("Users", ""));
        matches = r.filter(item => ids.has(item["id"]));
      }
    } else {
      r = await this.tryGetResource(resourceName);
      matches = r.list.filter(item => ids.has(item["id"]));
    }

    return {
      data: matches
    };
  }

  public async apiGetManyReference(
    resourceName: string,
    params: IParamsGetManyReference
  ): Promise<IResponseGetManyReference> {
    let data;
    const targetField = params.target;
    const targetValue = params.id;
    let matches;

    if (
      [
        "analysisActionsUsers",
        "analysisDataUsers",
        "analysisProductionUsers",
        "analysisSystemUsers",
        "analysisTeamUsers"
      ].indexOf(resourceName) !== -1
    ) {
      data = await this.getFirebaseSource(resourceName);
      matches = data.filter(val => val[targetField] === targetValue);
      if (matches.length < 1) {
        data = await this.getFirebaseSource(resourceName.replace("Users", ""));
        matches = data.filter(val => val[targetField] === targetValue);
      }
    } else {
      let r = await this.tryGetResource(resourceName);
      data = r.list;
      matches = data.filter(val => val[targetField] === targetValue);
    }

    if (params.sort != null) {
      const { field, order } = params.sort;
      if (order === "ASC") {
        this.sortArray(data, field, "asc");
      } else {
        this.sortArray(data, field, "desc");
      }
    }
    const pageStart = (params.pagination.page - 1) * params.pagination.perPage;
    const pageEnd = pageStart + params.pagination.perPage;

    const dataPage = matches.slice(pageStart, pageEnd);
    const total = matches.length;
    return { data: dataPage, total };
  }

  public GetResource(resourceName: string): IResource {
    return this.tryGetResource(resourceName);
  }

  private sortArray(data: Array<{}>, field: string, dir: "asc" | "desc"): void {
    data.sort((a: {}, b: {}) => {
      const aValue = a[field] ? a[field].toString().toLowerCase() : "";
      const bValue = b[field] ? b[field].toString().toLowerCase() : "";
      if (aValue > bValue) {
        return dir === "asc" ? -1 : 1;
      }
      if (aValue < bValue) {
        return dir === "asc" ? 1 : -1;
      }
      return 0;
    });
  }

  private filterArray(
    data: Array<{}>,
    filterFields: { [field: string]: string }
  ): Array<{}> {
    if (isEmptyObj(filterFields)) {
      return data;
    }
    const fieldNames = Object.keys(filterFields);
    return data.filter(item =>
      fieldNames.reduce((previousMatched, fieldName) => {
        const fieldSearchText = filterFields[fieldName].toLowerCase();
        const dataFieldValue = item[fieldName];
        if (dataFieldValue == null) {
          return false;
        }
        const currentIsMatched = dataFieldValue
          .toLowerCase()
          .includes(fieldSearchText);
        return previousMatched || currentIsMatched;
      }, false)
    );
  }

  private async setList(
    newList: Array<{}>,
    resourceName: string
  ): Promise<void> {
    const resource = await this.tryGetResource(resourceName);
    resource.list = newList;
  }

  private tryGetResource(resourceName: string): IResource {
    const resource: IResource = this.resources[resourceName];
    if (!resource) {
      throw new Error(
        `react-admin-firebase: Cant find resource: "${resourceName}"`
      );
    }
    return resource;
  }

  private getCollectionObservable(
    collection: firebase.firestore.CollectionReference
  ): Observable<firebase.firestore.QuerySnapshot> {
    const observable: Observable<
      firebase.firestore.QuerySnapshot
    > = Observable.create((observer: any) => collection.onSnapshot(observer));
    // LOGGING
    return observable;
  }
}

export let fb: FirebaseClient;

export default function FirebaseProvider(config: {}) {
  if (!config) {
    throw new Error(
      "Please pass the Firebase config.json object to the FirebaseDataProvider"
    );
  }
  ISDEBUG = config["debug"];
  fb = new FirebaseClient(config);
  async function providerApi(
    type: string,
    resourceName: string,
    params: any
  ): Promise<any> {
    await fb.initPath(resourceName);
    switch (type) {
      case GET_MANY:
        return fb.apiGetMany(resourceName, params);
      case GET_MANY_REFERENCE:
        return fb.apiGetManyReference(resourceName, params);
      case GET_LIST:
        return fb.apiGetList(resourceName, params);
      case GET_ONE:
        return fb.apiGetOne(resourceName, params);
      case CREATE:
        return fb.apiCreate(resourceName, params);
      case UPDATE:
        return fb.apiUpdate(resourceName, params);
      case UPDATE_MANY:
        return fb.apiUpdateMany(resourceName, params);
      case DELETE:
        return fb.apiDelete(resourceName, params);
      case DELETE_MANY:
        return fb.apiDeleteMany(resourceName, params);
      default:
        return {};
    }
  }
  return providerApi;
}
