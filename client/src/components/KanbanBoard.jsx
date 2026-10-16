import { memo, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { STAGES } from '../constants.js';
import { isNewSince } from '../hooks/useBoardView.js';
import ApplicationCard from './ApplicationCard.jsx';

const sameCards = (prev, next) =>
  prev.onDelete === next.onDelete &&
  prev.newSince === next.newSince &&
  prev.gmailAccount === next.gmailAccount &&
  prev.cards.length === next.cards.length &&
  prev.cards.every((card, i) => card === next.cards[i]);

// Only re-renders when one of this column's cards changes.
const CardList = memo(function CardList({ cards, onDelete, gmailAccount, newSince }) {
  return cards.map((app, index) => (
    <Draggable key={app._id} draggableId={app._id} index={index}>
      {(provided, snapshot) => (
        <ApplicationCard
          app={app}
          provided={provided}
          isDragging={snapshot.isDragging}
          isNew={isNewSince(app, newSince)}
          onDelete={onDelete}
          gmailAccount={gmailAccount}
        />
      )}
    </Draggable>
  ));
}, sameCards);

export default function KanbanBoard({ applications, onMove, onDelete, gmailAccount, newSince }) {
  const columns = useMemo(() => {
    const byStage = Object.fromEntries(STAGES.map((stage) => [stage.id, []]));
    for (const app of applications) byStage[app.stage]?.push(app);
    return byStage;
  }, [applications]);

  const handleDragEnd = ({ draggableId, source, destination }) => {
    if (destination && destination.droppableId !== source.droppableId) {
      onMove(draggableId, destination.droppableId);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="board">
        {STAGES.map((stage) => {
          const cards = columns[stage.id];
          return (
            <div className="column" key={stage.id} style={{ '--stage-color': stage.color }}>
              <div className="column-head">
                <span className="stage-dot" />
                <span className="column-title">{stage.id}</span>
                <span className="column-count">{cards.length}</span>
              </div>
              <Droppable droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`column-body ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                  >
                    <CardList cards={cards} onDelete={onDelete} gmailAccount={gmailAccount} newSince={newSince} />
                    {provided.placeholder}
                    {!cards.length && !snapshot.isDraggingOver && <div className="column-empty">{stage.hint}</div>}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
