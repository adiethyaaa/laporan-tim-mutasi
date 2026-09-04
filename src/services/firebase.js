export { db, auth } from "../../firebase-config.js";
export {
  ref,
  push,
  onValue,
  remove,
  update,
  set,
  get
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
export {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
