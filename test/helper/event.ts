import { expect } from "chai"
import { Contract, Event, EventFilter } from "ethers"

export async function getEvent(contract: Contract, blockNumber: number, eventName: string): Promise<Event> {
  const filter: EventFilter = {
    address: contract.address,
    topics: [contract.interface.getEventTopic(eventName)],
  }
  const event = (await contract.queryFilter(filter, blockNumber, blockNumber))[0]
  return event
}

export function expectEmit(event: Event, ...args: any[]) {
  event.args?.forEach((arg, i) => {
    expect(arg).to.be.equal(args[i])
  })
}
