/*  */

import React from "react";

import History from "./../result-view/history";

export default class Watch extends React.Component {
  componentDidMount() {
    this.container.insertBefore(
      this.props.store.editor.element,
      this.container.firstChild
    );
  }

  render() {
    return (
      <div
        className="hydrogen watch-view"
        ref={c => {
          this.container = c;
        }}
      >
        <History store={this.props.store.outputStore} />
      </div>
    );
  }
}
