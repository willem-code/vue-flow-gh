import useStore from './useStore'
import useHooks from './useHooks'
import { EmitFunc, FlowStore } from '~/types'

let key = 0
export const initFlow = (emit: EmitFunc, id = `vue-flow-${key++}`): FlowStore => {
  const store = useStore({ id })
  useHooks(store, emit)
  return store
}

export default useStore
