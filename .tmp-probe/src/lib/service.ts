import { helper } from './helper'
import './theme.scss'

export abstract class BaseService {
  run() {
    return helper()
  }
}

export default class UserService extends BaseService {}

export const LABEL = 'user'
