import axios from 'axios'

const baseURL = import.meta.env.VITE_BASE_PATH? import.meta.env.VITE_BASE_PATH + 'api' : '/api'

const base = axios.create({
  baseURL: baseURL,
  headers: {
    'Content-type': 'application/json',
  },
})

const download =  axios.create({
  baseURL: baseURL,
  responseType: 'blob'
})

const submitInstance = axios.create({
  baseURL: baseURL,
  headers: {
    'Content-type': 'application/json',
  },
})


export default {
  submission: submitInstance,
  base: base,
  download:download
}
