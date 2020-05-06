import * as firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";

import {
  AUTH_LOGIN,
  AUTH_LOGOUT,
  AUTH_ERROR,
  AUTH_CHECK,
  AUTH_GET_PERMISSIONS
} from "react-admin";

import { Observable } from "rxjs";

function log(description: string, obj?: {}) {
  if (ISDEBUG) {
    console.log("FirebaseAuthProvider: " + description, obj);
  }
}

var ISDEBUG = false;


class AuthClient {
  app: firebase.app.App;
  auth: firebase.auth.Auth;
  db: firebase.firestore.Firestore;

  constructor(firebaseConfig: {}) {
    log("Auth Client: initializing...");
    if (!firebase.apps.length) {
      this.app = firebase.initializeApp(firebaseConfig);
    } else {
      this.app = firebase.app();
    }
    this.auth = firebase.auth();
	this.db = this.app.firestore();
  }

  async HandleAuthLogin(params) {
    const { username, password } = params;
    console.log('HandleAuthLogin......');
    try {
		console.log('no hay token,signInWithEmailAndPassword');
      const user = await this.auth.signInWithEmailAndPassword(
        username,
        password
      );
	  log("HandleAuthLogin: user sucessfully logged in", { user });

      
    } catch (e) {
      log("HandleAuthLogin: invalid credentials", { params });
      throw new Error("Login error: invalid credentials");
    }
  }

  async HandleAuthLogout(params) {
	console.log('HandleAuthLogout');
    await this.auth.signOut();
  }

  async HandleAuthError(params) {}

  async HandleAuthCheck(params) {
    try {
      const user = await this.getUserLogin();
      log("HandleAuthCheck: user is still logged in", { user });
      console.log("HandleAuthCheck: user is still logged in", { user });
    } catch (e) {
      log("HandleAuthCheck: ", { e });
      console.log("HandleAuthCheck: ", { e });
      return Promise.reject();
    }
  }

  async getUserLogin() {
    return new Promise((resolve, reject) => {
      this.auth.onAuthStateChanged(user => {
        if (user) {
          resolve(user);
        } else {
          reject("User not logged in");
        }
      });
    });
  }
  
  async getPermissions() {
    return new Promise((resolve, reject) => {
      this.auth.onAuthStateChanged(user => {
        if (user) {
		  var userRef = firebase.firestore().collection('users').doc(user.uid || '');
		  var getDoc = userRef.get()
		  .then(doc => {
			if (!doc.exists) {
			  resolve('user');
			} else {
			  resolve(doc.data().isAdmin?'admin':'user');
			}
		  })
		  .catch(err => {
			console.log('Error getting document', err);
			reject();
		  }); 
        } else {
		  console.log('no hay permisos......');
		  resolve('guest');
          //reject("User not logged in");
        }
      });
    });
  }  
  
  async getUserPermissions(email) {
    return new Promise((resolve, reject) => {
		var userRef = firebase.firestore().collection('users').doc(email);
		var getDoc = userRef.get()
		  .then(doc => {
			if (!doc.exists) {
			  resolve(false);
			} else {
			  resolve(doc.data().isAdmin);
			}
		  })
		  .catch(err => {
			console.log('Error getting document', err);
			reject();
		  });
			});
  }
  
  
}

function SetUpAuth(config: {}) {
  if (!config) {
    throw new Error(
      "Please pass the Firebase config.json object to the FirebaseAuthProvider"
    );
  }
  ISDEBUG = config["debug"];
  const auth = new AuthClient(config);

  return async function(type: string, params: {}) {
    log("Auth Event: ", { type, params });

    {
      switch (type) {
        case AUTH_LOGIN:
          await auth.HandleAuthLogin(params);
        case AUTH_LOGOUT:
          await auth.HandleAuthLogout(params);
        case AUTH_ERROR:
          await auth.HandleAuthError(params);
        case AUTH_CHECK:
          await auth.HandleAuthCheck(params);
        case AUTH_GET_PERMISSIONS:
          return await auth.getPermissions();
        default:
          throw new Error("Unhandled auth type:" + type);
      }
    }
  };
}

export default SetUpAuth;
