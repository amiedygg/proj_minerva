import { ipcMain } from 'electron'
import { IPC_CHANNELS, type IpcChannel, type IpcRequest, type IpcResponse } from '../../shared/ipc'
import { payloadValidators } from './validators'

type Handler<C extends IpcChannel> = (
  req: IpcRequest<C>,
) => Promise<IpcResponse<C>> | IpcResponse<C>

const registeredChannels = new Set<IpcChannel>()

/**
 * Envuelve `ipcMain.handle` con:
 * - validación de que el canal es uno declarado en el contrato IPC.
 * - validación mínima de la forma del payload en runtime.
 * - captura de errores del handler, relanzados con un mensaje limpio (sin stack
 *   interno de main, que no debe llegar al renderer).
 */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  if (!(IPC_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`Canal IPC no declarado en el contrato: ${channel}`)
  }
  if (registeredChannels.has(channel)) {
    throw new Error(`Canal IPC ya registrado: ${channel}`)
  }
  registeredChannels.add(channel)

  ipcMain.handle(channel, async (_event, payload: unknown) => {
    // Validación profunda por canal (`./validators.ts`): forma exacta del
    // payload esperado por ese canal en particular, no solo "es un objeto".
    // El mensaje de error es genérico a propósito — nunca describe qué campo
    // falló ni el valor recibido, para no filtrar detalles internos al renderer.
    if (!payloadValidators[channel](payload)) {
      throw new Error(`Payload inválido para el canal "${channel}"`)
    }
    try {
      return await handler(payload as IpcRequest<C>)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Se preserva `cause` para no perder el error original en herramientas de
      // diagnóstico locales, pero solo `message` viaja al renderer via IPC (el
      // stack interno de main no debe cruzar la frontera de seguridad).
      throw new Error(message, { cause: error })
    }
  })
}
