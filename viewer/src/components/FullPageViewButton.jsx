import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import FontAwesomeIcon from '@fortawesome/react-fontawesome';
import { faExpand, faCompress } from '@fortawesome/fontawesome-free-solid';

import Actions from '../actions/actions';

class FullPageViewButton extends React.Component {

    static propTypes = {
        isFullPageView: PropTypes.bool.isRequired
    };

    onClick = () => {
        this.props.toggleFullPageView(!this.props.isFullPageView);
    };

    render() {
        return (
            <div title="Switch full page mode!">
                <FontAwesomeIcon
                    className="control_button"
                    icon={this.props.isFullPageView ? faCompress : faExpand}
                    onClick={this.onClick}
                />
            </div>
        );
    }
}

export default connect(state => ({
    isFullPageView: state.isFullPageView
}), {
        toggleFullPageView: Actions.toggleFullPageViewAction
    })(FullPageViewButton);