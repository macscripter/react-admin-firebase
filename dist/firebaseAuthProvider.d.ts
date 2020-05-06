import "firebase/auth";
import "firebase/firestore";
declare function SetUpAuth(config: {}): (type: string, params: {}) => Promise<{}>;
export default SetUpAuth;
