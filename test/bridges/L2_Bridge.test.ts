import '@nomiclabs/hardhat-waffle'
import { expect } from 'chai'
import { Signer, Contract, BigNumber } from 'ethers'
import Transfer from '../../lib/Transfer'
import MerkleTree from '../../lib/MerkleTree'

import { fixture } from '../shared/fixtures'
import {
  setUpDefaults,
  sendTestTokensAcrossCanonicalBridge,
  sendTestTokensAcrossHopBridge,
  expectBalanceOf,
  revertSnapshot,
  takeSnapshot
} from '../shared/utils'
import { IFixture } from '../shared/interfaces'

import {
  CHAIN_IDS,
  ONE_ADDRESS,
  DEFAULT_DEADLINE,
  USER_INITIAL_BALANCE,
  TRANSFER_AMOUNT,
  DEFAULT_AMOUNT_OUT_MIN,
  MAX_NUM_SENDS_BEFORE_COMMIT,
  ARBITRARY_ROOT_HASH
} from '../../config/constants'

/**
 * Note: This test uses an implementation of the L2 bridge but only tests the
 *       abstract L2_Bridge.sol.
 */

describe('L2_Bridge', () => {
  let _fixture: IFixture
  let l2ChainId: BigNumber

  let user: Signer
  let bonder: Signer
  let governance: Signer

  let l1_canonicalBridge: Contract
  let l1_canonicalToken: Contract
  let l1_bridge: Contract
  let l2_canonicalToken: Contract
  let l2_bridge: Contract
  let l2_messenger: Contract
  let l2_uniswapRouter: Contract

  let recipientL2Bridge: Contract

  let transfers: Transfer[]

  let userSendTokenAmount: BigNumber

  let transfer: Transfer
  let l2Transfer: Transfer

  let beforeAllSnapshotId: string
  let snapshotId: string

  before(async () => {
    beforeAllSnapshotId = await takeSnapshot()

    // Set up sending L2
    l2ChainId = CHAIN_IDS.OPTIMISM.TESTNET_1
    _fixture = await fixture(l2ChainId)
    await setUpDefaults(_fixture, l2ChainId)
    ;({
      user,
      bonder,
      governance,
      l1_canonicalBridge,
      l1_canonicalToken,
      l1_bridge,
      l2_canonicalToken,
      l2_bridge,
      l2_messenger,
      l2_uniswapRouter,
      transfers
    } = _fixture)

    // Set up receiving L2
    const recipientL2ChainId = CHAIN_IDS.ARBITRUM.TESTNET_3
    const recipientFixture = await fixture(recipientL2ChainId)
    await setUpDefaults(recipientFixture, recipientL2ChainId)
    ;({ l2_bridge: recipientL2Bridge } = recipientFixture)

    userSendTokenAmount = USER_INITIAL_BALANCE

    transfer = Object.assign(transfers[0], {})
    l2Transfer = Object.assign(transfers[1], {})
  })

  after(async() => {
    await revertSnapshot(beforeAllSnapshotId)
  })

  // Take snapshot before each test and revert after each test
  beforeEach(async() => {
    snapshotId = await takeSnapshot()
  })

  afterEach(async() => {
    await revertSnapshot(snapshotId)
  })


  /**
   * Happy Path
   */

  it('Should set the correct values in the constructor', async () => {
    const expectedL1GovernanceAddress = await governance.getAddress()
    const expectedL2CanonicalTokenAddress = l2_canonicalToken.address
    const expectedL1BridgeAddress = l1_bridge.address
    const expectedIsChainIdSupported = true
    const expectedIsBonder = true

    const l1GovernanceAddress = await l2_bridge.l1Governance()
    const l2CanonicalTokenAddress = await l2_bridge.l2CanonicalToken()
    const l1BridgeAddress = await l2_bridge.l1BridgeAddress()
    const isChainIdSupported = await l2_bridge.supportedChainIds(
      CHAIN_IDS.ETHEREUM.MAINNET
    )
    const isBonder = await l2_bridge.getIsBonder(await bonder.getAddress())

    expect(expectedL1GovernanceAddress).to.eq(l1GovernanceAddress)
    expect(expectedL2CanonicalTokenAddress).to.eq(l2CanonicalTokenAddress)
    expect(expectedL1BridgeAddress).to.eq(l1BridgeAddress)
    expect(expectedIsChainIdSupported).to.eq(isChainIdSupported)
    expect(expectedIsBonder).to.eq(isBonder)
  })

  it('Should set the exchange address arbitrarily', async () => {
    const expectedExchangeAddress = ONE_ADDRESS

    await l2_bridge
      .connect(governance)
      .setExchangeAddress(expectedExchangeAddress)
    const exchangeAddress = await l2_bridge.exchangeAddress()
    expect(exchangeAddress).to.eq(expectedExchangeAddress)
  })

  it('Should set the L1 bridge address arbitrarily', async () => {
    const expectedL1BridgeAddress = ONE_ADDRESS

    await l2_bridge
      .connect(governance)
      .setL1BridgeAddress(expectedL1BridgeAddress)
    const l1BridgeAddress = await l2_bridge.l1BridgeAddress()
    expect(l1BridgeAddress).to.eq(expectedL1BridgeAddress)
  })

  it('Should add support for a new chainId', async () => {
    const newChainId = CHAIN_IDS.ETHEREUM.KOVAN

    // Remove it, since our testing suite adds all chains by default
    await l2_bridge.connect(governance).removeSupportedChainIds([newChainId])
    let isChainIdSupported = await l2_bridge.supportedChainIds(newChainId)
    expect(isChainIdSupported).to.eq(false)

    await l2_bridge.connect(governance).addSupportedChainIds([newChainId])

    isChainIdSupported = await l2_bridge.supportedChainIds(newChainId)
    expect(isChainIdSupported).to.eq(true)
  })

  it('Should add support for a new chainId then remove it', async () => {
    const newChainId = CHAIN_IDS.ETHEREUM.KOVAN

    // Remove it, since our testing suite adds all chains by default
    await l2_bridge.connect(governance).removeSupportedChainIds([newChainId])
    let isChainIdSupported = await l2_bridge.supportedChainIds([newChainId])
    expect(isChainIdSupported).to.eq(false)

    await l2_bridge.connect(governance).addSupportedChainIds([newChainId])

    isChainIdSupported = await l2_bridge.supportedChainIds(newChainId)
    expect(isChainIdSupported).to.eq(true)

    await l2_bridge.connect(governance).removeSupportedChainIds([newChainId])

    isChainIdSupported = await l2_bridge.supportedChainIds(newChainId)
    expect(isChainIdSupported).to.eq(false)
  })

  it('Should send tokens across the bridge via send', async () => {
    // Add hToken to the users' address on L2
    await sendTestTokensAcrossHopBridge(
      l1_canonicalToken,
      l1_bridge,
      l2_bridge,
      l2_messenger,
      user,
      userSendTokenAmount,
      l2ChainId
    )

    // Execute transaction
    await l2_bridge.connect(governance).addSupportedChainIds([transfer.chainId])
    await l2_bridge
      .connect(user)
      .send(
        transfer.chainId,
        await transfer.recipient.getAddress(),
        transfer.amount,
        transfer.transferNonce,
        transfer.relayerFee,
        transfer.amountOutMin,
        transfer.deadline
      )

    // Verify state
    const expectedCurrentBridgeBal = userSendTokenAmount.sub(TRANSFER_AMOUNT)
    await expectBalanceOf(l2_bridge, user, expectedCurrentBridgeBal)

    const expectedPendingTransferHash: Buffer = await transfer.getTransferId()
    const pendingAmountChainId = await l2_bridge.pendingAmountChainIds(0)
    const expectedPendingAmountChainId = transfer.chainId
    expect(pendingAmountChainId).to.eq(expectedPendingAmountChainId)

    const pendingAmount = await l2_bridge.pendingAmountForChainId(
      transfer.chainId
    )
    const expectedPendingAmount = transfer.amount
    expect(pendingAmount).to.eq(expectedPendingAmount)

    const transfersSentEvent = (
      await l2_bridge.queryFilter(l2_bridge.filters.TransferSent())
    )[0]
    const transferSentArgs = transfersSentEvent.args
    expect(transferSentArgs[0]).to.eq(
      '0x' + expectedPendingTransferHash.toString('hex')
    )
    expect(transferSentArgs[1]).to.eq(await transfer.recipient.getAddress())
    expect(transferSentArgs[2]).to.eq(TRANSFER_AMOUNT)
    expect(transferSentArgs[3]).to.eq(transfer.transferNonce)
    expect(transferSentArgs[4]).to.eq(transfer.relayerFee)
  })

  it('Should send tokens across the bridge via swapAndSend', async () => {
    const expectedAmounts: BigNumber[] = await l2_uniswapRouter.getAmountsOut(
      transfer.amount,
      [l2_canonicalToken.address, l2_bridge.address]
    )
    const expectedAmountAfterSlippage: BigNumber = expectedAmounts[1]

    // Add the canonical token to the users' address on L2
    await sendTestTokensAcrossCanonicalBridge(
      l1_canonicalToken,
      l1_canonicalBridge,
      l2_canonicalToken,
      l2_messenger,
      user,
      userSendTokenAmount
    )

    // Execute transaction
    await l2_bridge.connect(governance).addSupportedChainIds([transfer.chainId])
    await l2_canonicalToken
      .connect(user)
      .approve(l2_bridge.address, userSendTokenAmount)
    await l2_bridge
      .connect(user)
      .swapAndSend(
        transfer.chainId,
        await transfer.recipient.getAddress(),
        transfer.amount,
        transfer.transferNonce,
        transfer.relayerFee,
        transfer.amountOutMin,
        transfer.deadline,
        transfer.destinationAmountOutMin,
        transfer.destinationDeadline
      )

    // Verify state
    const expectedCurrentCanonicalTokenBal = userSendTokenAmount.sub(
      TRANSFER_AMOUNT
    )
    await expectBalanceOf(
      l2_canonicalToken,
      user,
      expectedCurrentCanonicalTokenBal
    )

    const transferAfterSlippage: Transfer = Object.assign(transfer, {
      amount: expectedAmountAfterSlippage
    })
    const expectedPendingTransferHash: Buffer = await transferAfterSlippage.getTransferId()

    const pendingAmountChainId = await l2_bridge.pendingAmountChainIds(0)
    const expectedPendingAmountChainId = transfer.chainId
    expect(pendingAmountChainId).to.eq(expectedPendingAmountChainId)

    const pendingAmount = await l2_bridge.pendingAmountForChainId(
      transfer.chainId
    )
    const expectedPendingAmount = transfer.amount
    expect(pendingAmount).to.eq(expectedPendingAmount)

    const transfersSentEvent = (
      await l2_bridge.queryFilter(l2_bridge.filters.TransferSent())
    )[0]
    const transferSentArgs = transfersSentEvent.args
    expect(transferSentArgs[0]).to.eq(
      '0x' + expectedPendingTransferHash.toString('hex')
    )
    expect(transferSentArgs[1]).to.eq(await transfer.recipient.getAddress())
    expect(transferSentArgs[2]).to.eq(transferAfterSlippage.amount)
    expect(transferSentArgs[3]).to.eq(transfer.transferNonce)
    expect(transferSentArgs[4]).to.eq(transfer.relayerFee)
  })

  // TODO: Changed with contract updates
  it.skip('Should commit a transfer', async () => {
    // Add hToken to the users' address on L2
    await sendTestTokensAcrossHopBridge(
      l1_canonicalToken,
      l1_bridge,
      l2_bridge,
      l2_messenger,
      user,
      userSendTokenAmount,
      l2ChainId
    )

    // Execute transaction
    await l2_bridge.connect(governance).addSupportedChainIds([transfer.chainId])
    await l2_bridge
      .connect(user)
      .send(
        transfer.chainId,
        await transfer.recipient.getAddress(),
        transfer.amount,
        transfer.transferNonce,
        transfer.relayerFee,
        transfer.amountOutMin,
        transfer.deadline
      )

    // Verify state pre-transaction
    let pendingAmountForChainId = await l2_bridge.pendingAmountForChainId(
      transfer.chainId
    )
    expect(pendingAmountForChainId).to.eq(transfer.amount)
    let pendingAmountChainIds = await l2_bridge.pendingAmountChainIds(0)
    expect(pendingAmountChainIds).to.eq(transfer.chainId)

    // Commit the transfer
    await l2_bridge.connect(bonder).commitTransfers(transfer.chainId)

    // Verify state post-transaction
    pendingAmountForChainId = await l2_bridge.pendingAmountForChainId(
      transfer.chainId
    )
    expect(pendingAmountForChainId).to.eq(0)

    const expectedMerkleTree = new MerkleTree([await transfer.getTransferId()])

    const transfersCommittedEvent = (
      await l2_bridge.queryFilter(l2_bridge.filters.TransfersCommitted())
    )[0]
    const transfersCommittedArgs = transfersCommittedEvent.args
    expect(transfersCommittedArgs[0]).to.eq(expectedMerkleTree.getHexRoot())
    const pendingAmountChainId = transfersCommittedArgs[1][0]
    expect(pendingAmountChainId).to.eq(transfer.chainId)
    const pendingChainAmounts = transfersCommittedArgs[2][0]
    expect(pendingChainAmounts).to.eq(transfer.amount)
  })

  it('Should mint hTokens', async () => {
    const tokenAmount: BigNumber = USER_INITIAL_BALANCE

    // Verify no tokens available
    let expectedBalance: BigNumber = BigNumber.from('0')
    await expectBalanceOf(l2_bridge, user, expectedBalance)

    // Make swap from l1 bridge
    await l1_canonicalToken
      .connect(user)
      .approve(l1_bridge.address, tokenAmount)
    await l1_bridge
      .connect(user)
      .sendToL2(l2ChainId.toString(), await user.getAddress(), tokenAmount)
    await l2_messenger.relayNextMessage()

    // Verify token mint on L2
    expectedBalance = BigNumber.from(tokenAmount)
    await expectBalanceOf(l2_bridge, user, expectedBalance)
  })

  it('Should mint hTokens and swap for canonical tokens', async () => {
    const tokenAmount: BigNumber = USER_INITIAL_BALANCE

    // Verify no tokens available
    let expectedBalance: BigNumber = BigNumber.from('0')
    await expectBalanceOf(l2_canonicalToken, user, expectedBalance)

    // Make swap from l1 bridge
    const expectedAmounts: BigNumber[] = await l2_uniswapRouter.getAmountsOut(
      tokenAmount,
      [l2_canonicalToken.address, l2_bridge.address]
    )
    const expectedAmountAfterSlippage: BigNumber = expectedAmounts[1]

    await l1_canonicalToken
      .connect(user)
      .approve(l1_bridge.address, tokenAmount)
    await l1_bridge
      .connect(user)
      .sendToL2AndAttemptSwap(
        l2ChainId.toString(),
        await user.getAddress(),
        tokenAmount,
        DEFAULT_AMOUNT_OUT_MIN,
        DEFAULT_DEADLINE
      )
    await l2_messenger.relayNextMessage()

    // Verify token mint on L2
    expectedBalance = BigNumber.from(expectedAmountAfterSlippage)
    await expectBalanceOf(l2_canonicalToken, user, expectedBalance)
  })

  // TODO: Changed with contract updates
  it.skip('Should send tokens from one L2 to another while the bonder is offline via withdrawAndAttemptSwap', async () => {
    const numberOfSendsToOverflow: number = MAX_NUM_SENDS_BEFORE_COMMIT + 1
    for (let i = 0; i < numberOfSendsToOverflow; i++) {
      // Mint canonical tokens on L1
      await l1_canonicalToken.mint(await user.getAddress(), transfer.amount)

      // Add the canonical token to the users' address on L2
      await sendTestTokensAcrossCanonicalBridge(
        l1_canonicalToken,
        l1_canonicalBridge,
        l2_canonicalToken,
        l2_messenger,
        user,
        userSendTokenAmount
      )

      // Execute transaction
      await l2_bridge.connect(governance).addSupportedChainIds([transfer.chainId])
      await l2_canonicalToken
        .connect(user)
        .approve(l2_bridge.address, userSendTokenAmount)
      await l2_bridge
        .connect(user)
        .swapAndSend(
          transfer.chainId,
          transfer.recipient,
          transfer.amount,
          transfer.transferNonce,
          transfer.relayerFee,
          transfer.amountOutMin,
          transfer.deadline,
          transfer.destinationAmountOutMin,
          transfer.destinationDeadline
        )

      transfer.transferNonce += 1
    }

    try {
      // The array should have been deleted and only a single item (index 0) should exist
      await l2_bridge.pendingAmountChainIds(1)
      throw new Error('There should not be a pending transfer in this slot.')
    } catch (err) {
      const expectedErrorMsg: string =
        'VM Exception while processing transaction: invalid opcode'
      expect(err.message).to.eq(expectedErrorMsg)
    }

    try {
      // The array should have been deleted and only a single item (index 0) should exist
      await l2_bridge.pendingTransfers(1)
      throw new Error('There should not be a pending transfer in this slot.')
    } catch (err) {
      const expectedErrorMsg: string =
        'VM Exception while processing transaction: invalid opcode'
      expect(err.message).to.eq(expectedErrorMsg)
    }

    // TODO: When _sendCrossDomainImplementation is implemented, the last l2_bridge.swapAndSend() should atomically
    // call the l2_canonicalMessenger, which should automatically call l1_bridge.confirmTransferRoot() which should
    // atomically call recipientL2Bridge.setTransferRoot(). Then I can test the recipientL2Bridge.withdrawAndAttemptSwap()
  })

  it('Should send a transfer from one L2 to another L2 via bondWithdrawalAndAttemptSwap', async () => {
    transfer.destinationAmountOutMin = BigNumber.from(0)
    transfer.destinationDeadline = BigNumber.from(DEFAULT_DEADLINE)

    // Add the canonical token to the users' address on L2
    await sendTestTokensAcrossCanonicalBridge(
      l1_canonicalToken,
      l1_canonicalBridge,
      l2_canonicalToken,
      l2_messenger,
      user,
      userSendTokenAmount
    )

    // Execute transaction
    await l2_bridge.connect(governance).addSupportedChainIds([transfer.chainId])
    await l2_canonicalToken
      .connect(user)
      .approve(l2_bridge.address, userSendTokenAmount)
    await l2_bridge
      .connect(user)
      .swapAndSend(
        transfer.chainId,
        await transfer.recipient.getAddress(),
        transfer.amount,
        transfer.transferNonce,
        transfer.relayerFee,
        transfer.amountOutMin,
        transfer.deadline,
        transfer.destinationAmountOutMin,
        transfer.destinationDeadline
      )

    // TODO: Mimic the cross chain test and verify state
  })

  it('Should set the transfer root', async () => {
    const arbitraryAmount: number = 123

    // Verify that the l1 bridge is the only account who can set it
    // TODO: Introduce this when `_verifySender()` implementation is added
    // expect(await l2_bridge.setTransferRoot(ARBITRARY_ROOT_HASH, arbitraryAmount)).to.throw('hi')

    // Update l1 bridge address for testing purposes
    await l2_bridge.setL1BridgeAddress(await user.getAddress())
    expect(await l2_bridge.l1BridgeAddress()).to.eq(await user.getAddress())

    await l2_bridge.setTransferRoot(ARBITRARY_ROOT_HASH, arbitraryAmount)

    const transferRoot = await l2_bridge.getTransferRoot(ARBITRARY_ROOT_HASH, arbitraryAmount)
    expect(transferRoot[0]).to.eq(arbitraryAmount)
    expect(transferRoot[1]).to.eq(0)
  })

  // TODO: Over 100 pending transfers in send() (test is basically already written in 'Should send tokens from one L2 to another while the bonder is offline')
  // TODO: swapAndSend to same user on a different L2
  // TODO: swapAndSend to self on a different L2
  // TODO: Commit multiple
  // TODO: (maybe another file) single leaf tree and multiple leaf tree

  /**
   * Non-Happy Path
   */

  // TODO: only governance
  // TODO: all requires -- even those in children contracts
  // TODO: modifiers
  // TODO: Same nonce shouldn't work
  // TODO: Does 200 transfers without a bond event work?
})
