/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("org_tree_cache");
  collection.createRule = "";
  collection.listRule = "";
  collection.viewRule = "";
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("org_tree_cache");
  collection.createRule = null;
  collection.listRule = null;
  collection.viewRule = null;
  return app.save(collection);
})
