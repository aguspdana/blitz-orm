import type { TraversalCallbackContext } from 'object-traversal';
import { traverse } from 'object-traversal';
import { isArray, isObject, mapEntries, pick, shake } from 'radash';
import { v4 as uuidv4 } from 'uuid';

import { oFilter, getCurrentFields, getCurrentSchema, getParentNode } from '../../../helpers';
import type { BQLMutationBlock, EnrichedBQLMutationBlock, EnrichedBormSchema } from '../../../types';
import { computeField } from '../../../engine/compute';
import { deepRemoveMetaData } from '../../../../tests/helpers/matchers';

export const parseBQLMutation = async (
	blocks: EnrichedBQLMutationBlock | EnrichedBQLMutationBlock[],
	schema: EnrichedBormSchema,
) => {
	//console.log('filledBqlRequest', JSON.stringify(filledBqlRequest, null, 2));

	const listNodes = (blocks: EnrichedBQLMutationBlock | EnrichedBQLMutationBlock[]) => {
		// todo: make immutable

		const nodes: BQLMutationBlock[] = [];
		const edges: BQLMutationBlock[] = [];

		/*
    function getIdsByPath(path: string) {
      const ids = nodes.filter((node) => node[Symbol.for('path') as any] === path).map((node) => node.id);
      return ids.length === 1 ? ids[0] : ids;
    } */

		const getIdValue = (node: EnrichedBQLMutationBlock) => {
			if (node.$id) {
				return node.$id;
			}

			const currentSchema = getCurrentSchema(schema, node);
			const { idFields } = currentSchema;

			if (!idFields) {
				throw new Error(`no idFields: ${JSON.stringify(node)}`);
			}
			// todo: composite ids
			const [idField] = idFields;
			if (!idField) {
				throw new Error(`no idField: ${JSON.stringify(node)}`);
			}
			/// This is adding idfields for intermediary relations. In the future maybe it would be better to add the intermediary relations in the enrich step?
			const idDataField = currentSchema.dataFields?.find((x) => x.path === idField);

			const defaultIdField = computeField({
				currentThing: node,
				fieldSchema: idDataField, //id is always a datafield.
				mandatoryDependencies: true, //can't send to db without every dependency being there
			});

			const idValue = node[idField] || node.$id || defaultIdField;

			if (!idValue) {
				throw new Error(`no idValue: ${JSON.stringify(node)}`);
			}
			return idValue;
		};

		const toNodes = (node: EnrichedBQLMutationBlock) => {
			if (node.$op === 'create') {
				const idValue = getIdValue(node);

				if (nodes.find((x) => x.$id === idValue)) {
					throw new Error(`Duplicate id ${idValue} for node ${JSON.stringify(node)}`);
				}
				if (edges.find((x) => x.$bzId === node.$bzId)) {
					throw new Error(`Duplicate $bzid ${node.$bzId} for node ${JSON.stringify(node)}`);
				}
				nodes.push({ ...node, $id: idValue });
				return;
			}

			//@ts-expect-error - TODO
			if (node.$tempId && node.$op === 'match') {
				/// we don't add to the node list, those that are being matched as they don't need to be matched in db and if they have a $tempId then it means... they are being created in the same query!
				return;
			}
			nodes.push(node);
		};

		const toEdges = (edge: EnrichedBQLMutationBlock) => {
			if (edge.$op === 'create') {
				const idValue = getIdValue(edge);

				if (nodes.find((x) => x.$id === idValue)) {
					// throw new Error(`Duplicate id ${idValue} for edge ${JSON.stringify(edge)}`);
				}
				if (edges.find((x) => x.$bzId === edge.$bzId)) {
					throw new Error(`Duplicate %bzId ${edge.$bzIdd} for edge ${JSON.stringify(edge)}`);
				}
				edges.push({ ...edge, $id: idValue });
				return;
			}
			edges.push(edge);
		};

		const listOp = ({ value: val, meta, parent }: TraversalCallbackContext) => {
			if (!isObject(val)) {
				return;
			}
			const value = val as EnrichedBQLMutationBlock;

			/// no idea why this is needed lol, but sometimes is indeed undefined 🤷‍♀️
			if (value.$thing) {
				if (!value.$op) {
					throw new Error(`Operation should be defined at this step ${JSON.stringify(value)}`);
				}

				if (!value.$bzId) {
					throw new Error('[internal error] BzId not found');
				}
				/// this is used to group the right delete/unlink operations with the involved things

				const currentThingSchema = getCurrentSchema(schema, value);
				const {
					dataFields: dataFieldPaths,
					roleFields: roleFieldPaths,
					linkFields: linkFieldPaths,
					usedFields,
				} = getCurrentFields(currentThingSchema, value);

				const getChildOp = () => {
					if (value.$op === 'create' || value.$op === 'delete') {
						return value.$op;
					}
					// if its un update because linkfields or rolefields updated, but no attributes, then it a match
					if (value.$op === 'update') {
						const usedDataFields = usedFields.filter((x: string) => dataFieldPaths?.includes(x));
						const usedRoleFields = usedFields.filter((x: string) => roleFieldPaths?.includes(x));
						const usedLinkFields = usedFields.filter((x: string) => linkFieldPaths?.includes(x));
						if (usedDataFields.length > 0) {
							return 'update';
						}
						if (usedRoleFields.length > 0 || usedLinkFields.length > 0) {
							return 'match';
						}
						throw new Error(`No fields on an $op:"update" for node ${JSON.stringify(value)}`);
					}

					return 'match';
				};

				const dataObj = {
					...(value.$entity && { $entity: value.$entity }),
					...(value.$relation && { $relation: value.$relation }),
					...(value.$id && { $id: value.$id }),
					...(value.$tempId && { $tempId: value.$tempId }),
					...(value.$filter && { $filter: value.$filter }),
					...shake(pick(value, dataFieldPaths || [''])),
					$op: getChildOp(),
					$bzId: value.$tempId ? value.$tempId : value.$bzId,
					[Symbol.for('dbId')]: currentThingSchema.defaultDBConnector.id,
					// [Symbol.for('dependencies')]: value[Symbol.for('dependencies')],
					[Symbol.for('path')]: value[Symbol.for('path') as any],

					[Symbol.for('isRoot')]: value[Symbol.for('isRoot') as any],
				};

				/// split nodes with multiple ids // why? //no longer doing that
				toNodes(dataObj);

				// console.log('value', isDraft(value) ? current(value) : value);

				// CASE 1: HAVE A PARENT THROUGH LINKFIELDS
				if (
					value[Symbol.for('relation') as any] &&
					value[Symbol.for('edgeType') as any] === 'linkField'
					// value[Symbol.for('relation')] !== '$self'
				) {
					if (value.$op === 'link' || value.$op === 'unlink') {
						if (value.$id || value.$filter) {
							if (value.$tempId) {
								throw new Error("can't specify a existing and a new element at once. Use an id/filter or a tempId");
							}
							nodes.push({ ...value, $op: 'match' });
						}
						// we add a "linkable" version of it so we can query it in the insertion
					}

					// this linkObj comes from nesting, which means it has no properties and no ID
					// relations explicitely created are not impacted by this, and they get the $id from it's actual current value

					const ownRelation = value[Symbol.for('relation') as any] === value.$relation;

					const linkTempId = ownRelation ? value.$bzId : `LT_${uuidv4()}`;

					const parentNode = getParentNode(blocks, parent, meta);

					const parentId = parentNode.$bzId;
					if (!parentId) {
						throw new Error('No parent id found');
					}

					if (value[Symbol.for('relation') as any] === '$self') {
						return;
					}

					const getLinkObjOp = () => {
						if (value.$op === 'delete') {
							if (ownRelation) {
								return 'match';
							}
							return 'delete';
						}
						if (value.$op === 'unlink') {
							if (ownRelation) {
								return 'unlink';
							} // delete already present in the nodes array
							return 'delete';
						}
						if (value.$op === 'link' || value.$op === 'create') {
							if (ownRelation) {
								return 'link';
							} // create already present in the nodes array
							return 'create';
						}
						// todo: probably check replaces
						if (value.$op === 'replace') {
							// Currently pre-queries do not cross reference data nested below a create operation
							throw new Error('Unsupported: Nested replaces not implemented yet');
						}
						return 'match';
					};

					const edgeType1 = {
						$relation: value[Symbol.for('relation') as any],
						$bzId: linkTempId,
						...(value.$tempId ? { $tempId: value.$tempId } : {}),
						$op: getLinkObjOp(),

						// roles
						...(!ownRelation ? { [value[Symbol.for('role') as any]]: value.$bzId } : {}),
						[value[Symbol.for('oppositeRole') as any]]: parentId,

						[Symbol.for('dbId')]: schema.relations[value[Symbol.for('relation') as any]].defaultDBConnector.id,
						[Symbol.for('edgeType')]: 'linkField',
						[Symbol.for('info')]: 'normal linkField',
						[Symbol.for('path')]: value[Symbol.for('path') as any],
					};

					// const testVal = {};

					// todo: stuff 😂
					//@ts-expect-error - TODO
					toEdges(edgeType1);

					/// when it has a parent through a linkfield, we need to add an additional node (its dependency), as well as a match
					/// no need for links, as links will have all the related things in the "link" object. While unlinks required dependencies as match and deletions as unlink (or dependencies would be also added)
					/// this is only for relations that are not $self, as other relations will be deleted and don't need a match
					if ((value.$op === 'unlink' || getLinkObjOp() === 'unlink') && ownRelation) {
						toEdges({
							$relation: value[Symbol.for('relation') as any],
							$bzId: linkTempId,
							//@ts-expect-error - TODO
							$op: 'match',
							[value[Symbol.for('oppositeRole') as any]]: parentId,
							[Symbol.for('dbId')]: schema.relations[value[Symbol.for('relation') as any]].defaultDBConnector.id,
							[Symbol.for('edgeType')]: 'linkField',
							[Symbol.for('info')]: 'additional ownrelation unlink linkField',
							[Symbol.for('path')]: value[Symbol.for('path') as any],
						});
					}
				}

				// CASE 2: IS RELATION AND HAS THINGS IN THEIR ROLES
				if (value.$relation) {
					const rolesObjFiltered = oFilter(value, (k: string, _v) => roleFieldPaths.includes(k));

					/// we don't manage cardinality MANY for now, its managed differently if we are on a create/delete op or nested link/unlink op
					// todo: this is super weird, remove
					//@ts-expect-error - TODO
					const rolesObjOnlyIds = mapEntries(rolesObjFiltered, (k, v) => {
						if (isArray(v)) {
							return [k, v];
						}
						if (isObject(v)) {
							// @ts-expect-error - TODO description
							return [k, v.$bzId];
						}
						return [k, v];
					});

					// console.log('rolesObjOnlyIds', rolesObjOnlyIds);

					const objWithMetaDataOnly = oFilter(val, (k, _v) => {
						// @ts-expect-error - TODO description
						return k.startsWith('$') || k.startsWith('Symbol');
					});

					if (Object.keys(rolesObjFiltered).filter((x) => !x.startsWith('$')).length > 0) {
						// #region 2.1) relations on creation/deletion
						if (value.$op === 'create' || value.$op === 'delete') {
							/// if the relation is being created, then all objects in the roles are actually add
							const getEdgeOp = () => {
								if (value.$op === 'create') {
									return 'link';
								}
								if (value.$op === 'delete') {
									return 'match';
								} /// if i'm not wrong, no need to unlink becasue is the director relation and will disappear 🤔
								throw new Error('Unsupported parent of edge op');
							};

							/// group ids when cardinality MANY
							const rolesObjOnlyIdsGrouped = mapEntries(rolesObjOnlyIds, (k, v) => {
								if (Array.isArray(v)) {
									/// Replace the array of objects with an array of ids
									return [k, v.map((vNested: any) => vNested.$bzId || vNested)];
								}
								//@ts-expect-error - TODO
								return [k, v.$bzId || v];
							});
							// console.log('rolesObjOnlyIdsGrouped', rolesObjOnlyIdsGrouped);

							// todo: validations
							/// 1) each ONE role has only ONE element // 2) no delete ops // 3) no arrayOps, because it's empty (or maybe yes and just consider it an add?) ...
							const edgeType2 = {
								...objWithMetaDataOnly,
								$relation: value.$relation,
								$op: getEdgeOp(),
								...rolesObjOnlyIdsGrouped, // override role fields by ids or tempIDs
								$bzId: value.$bzId,
								[Symbol.for('path')]: value[Symbol.for('path') as any],
								[Symbol.for('dbId')]: currentThingSchema.defaultDBConnector.id,
								[Symbol.for('info')]: 'coming from created or deleted relation',
								[Symbol.for('edgeType')]: 'roleField on C/D',
							};

							//@ts-expect-error - TODO
							toEdges(edgeType2);
							return;
						}
						// #endregion
						// region 2.2 relations on nested stuff
						// todo: probably remove the match here
						//@ts-expect-error - TODO
						if (value.$op === 'match' || (value.$op === 'update' && Object.keys(rolesObjFiltered).length > 0)) {
							let totalUnlinks = 0;

							Object.entries(rolesObjFiltered).forEach(([role, operations]) => {
								const operationsArray = isArray(operations) ? operations : [operations];

								const getOp = (childOp: string) => {
									if (childOp === 'create' || childOp === 'replace') {
										// if the children is being created, the edge is a link
										return 'link';
									}
									return childOp;
								};

								operationsArray.forEach((operation) => {
									if (!operation) {
										return;
									}
									const op = getOp(operation.$op);
									/// validations
									if (op === 'replace') {
										throw new Error('Not supported yet: replace on roleFields');
									}
									if (op === 'unlink' && totalUnlinks > 0) {
										totalUnlinks += 1; // ugly temp solution while multiple roles can't be replaced
										throw new Error(
											'Not supported yet: Cannot unlink more than one role at a time, please split into two mutations',
										);
									}

									const edgeType3 = {
										...objWithMetaDataOnly,
										$relation: value.$relation,
										$op: op === 'delete' ? 'unlink' : op,
										[role]: operation.$bzId,
										$bzId: value.$bzId,
										[Symbol.for('dbId')]: currentThingSchema.defaultDBConnector.id,
										[Symbol.for('path')]: value[Symbol.for('path') as any],
										[Symbol.for('info')]: 'updating roleFields',
										[Symbol.for('edgeType')]: 'roleField on L/U/R',
									};

									//@ts-expect-error - TODO
									toEdges(edgeType3);
									/// when unlinking stuff, it must be merged with other potential roles.
									/// so we need to add it as both as match and 'unlink' so it gets merged with other unlinks
									// todo maybe a way to transform unlinks already in its own matches later? maybe split match-unlink and match-link
									if (op === 'unlink') {
										// toEdges({ ...edgeType3, $op: 'match' }); ///apparently no longer needed
									}
								});
							});
						}
						// #endregion
						// throw new Error('Unsupported direct relation operation');
					}
				}
			}
		};
		// console.log('[blocks]', JSON.stringify(blocks, null, 3));
		// console.log('[blocks]', blocks);

		traverse(blocks, listOp);

		return [nodes, edges];
	};

	const [parsedThings, parsedEdges] = listNodes(blocks);
	//console.log('parsedThings', parsedThings);
	//console.log('parsedEdges', parsedEdges);

	/// some cases where we extract things, they must be ignored.
	/// One of this cases is the situation where we have a thing that is linked somwhere and created, or updated.
	/// If it is only linked, we indeed need it with a "match" op, but if it is already there is no need to init it
	const mergedThings = parsedThings.reduce((acc, thing) => {
		// Skip if the current item doesn't have a $tempId
		if (!thing.$bzId) {
			return [...acc, thing];
		}

		// Check if this $tempId already exists in the accumulator
		const existingIndex = acc.findIndex((t) => t.$bzId === thing.$bzId);

		if (existingIndex === -1) {
			// If it doesn't exist, add it to the accumulator
			return [...acc, thing];
		}
		// If it exists, let's check the $op
		if (acc[existingIndex].$op === 'create' && thing.$op === 'match') {
			// If existing is 'create' and current is 'match', ignore current
			return acc;
		}
		if (acc[existingIndex].$op === 'match' && (thing.$op === 'create' || thing.$op === 'match')) {
			// If existing is 'match' and current is 'create' or 'match', replace existing with current
			return [...acc.slice(0, existingIndex), thing, ...acc.slice(existingIndex + 1)];
		}
		// For all other cases, throw an error
		throw new Error(
			`Unsupported operation combination for $tempId "${thing.$tempId}". Existing: ${acc[existingIndex].$op}. Current: ${thing.$op}`,
		);
	}, [] as BQLMutationBlock[]);

	/// merge attributes of relations that share the same $id
	/// WHY => because sometimes we get the relation because of having a parent, and other times because it is specified in the relation's properties
	const mergedEdges = parsedEdges.reduce((acc, curr) => {
		const existingEdge = acc.find(
			(r) =>
				((r.$id && r.$id === curr.$id) || (r.$bzId && r.$bzId === curr.$bzId)) &&
				r.$relation === curr.$relation &&
				r.$op === curr.$op,
		);

		if (existingEdge) {
			const newRelation = { ...existingEdge };

			Object.keys(curr).forEach((key) => {
				if (typeof key === 'symbol' || key.startsWith('$')) {
					return;
				}

				const existingVal = existingEdge[key];
				const currVal = curr[key];

				//both values are arrays
				if (Array.isArray(existingVal) && Array.isArray(currVal)) {
					newRelation[key] = Array.from(new Set([...existingVal, ...currVal]));
				}
				///the curent one is not but hte new one it is
				else if (!Array.isArray(existingVal) && Array.isArray(currVal)) {
					if (existingVal !== undefined) {
						// Avoid merging with undefined values.
						newRelation[key] = Array.from(new Set([existingVal, ...currVal]));
					} else {
						newRelation[key] = currVal;
					}
				}
				///the curent one is but hte new one it is not
				else if (Array.isArray(existingVal) && !Array.isArray(currVal)) {
					if (currVal !== undefined) {
						// Avoid merging with undefined values.
						newRelation[key] = Array.from(new Set([...existingVal, currVal]));
					}
				}
				//both exist and are not arrays
				else if (existingVal !== null && currVal !== null && existingVal !== undefined && currVal !== undefined) {
					newRelation[key] = Array.from(new Set([existingVal, currVal]));
				} else if (existingVal === undefined || existingVal === null) {
					newRelation[key] = currVal;
				}
			});

			const newAcc = acc.filter(
				(r) =>
					!(
						((r.$id && r.$id === curr.$id) || (r.$bzId && r.$bzId === curr.$bzId)) &&
						r.$relation === curr.$relation &&
						r.$op === curr.$op
					),
			);

			return [...newAcc, newRelation];
		}

		return [...acc, curr];
	}, [] as BQLMutationBlock[]);

	//console.log('mergedThings', mergedThings);
	//console.log('mergedEdges', mergedEdges);

	/// VALIDATIONS

	// VALIDATION: Check that every thing in the list that is an edge, has at least one player
	mergedThings.forEach((thing) => {
		if ('$relation' in thing) {
			//if it is a relation, we need at lease one edge defined for it
			if (
				mergedEdges.filter((edge) => edge.$bzId === thing.$bzId || (edge.$tempId && edge.$tempId === thing.$tempId))
					.length === 0
			) {
				if (thing.$op === 'delete' || thing.$op === 'match' || thing.$op === 'update') {
					return;
				}
				throw new Error(
					`[Borm] Can't create a relation without any player. Node: ${JSON.stringify(deepRemoveMetaData(thing))}`,
				);
			}
		}
	});

	return {
		mergedThings,
		mergedEdges,
	};
};
