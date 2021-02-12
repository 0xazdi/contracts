// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/optimism/messengers/iOVM_L2CrossDomainMessenger.sol";
import "./L2_Bridge.sol";

contract L2_OptimismBridge is L2_Bridge {
    iOVM_L2CrossDomainMessenger public messenger;

    constructor (
        iOVM_L2CrossDomainMessenger _messenger,
        address _l1Governance,
        IERC20 _canonicalToken,
        address _l1BridgeAddress,
        uint256[] memory _supportedChainIds,
        address[] memory _bonders,
        address _exchangeAddress,
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    )
        public
        L2_Bridge(
            _l1Governance,
            _canonicalToken,
            _l1BridgeAddress,
            _supportedChainIds,
            _bonders,
            _exchangeAddress,
            _name,
            _symbol,
            _decimals
        )
    {
        messenger = _messenger;
    }

    // TODO: Use a valid gasLimit
    function _sendCrossDomainMessage(bytes memory _message) internal override {
        messenger.sendMessage(
            l1BridgeAddress,
            _message,
            0
        );
    }

    function _verifySender(address _expectedSender) internal override {
        // ToDo: verify sender with Optimism L2 messenger
        // sender should be l1BridgeAddress
    }
}
