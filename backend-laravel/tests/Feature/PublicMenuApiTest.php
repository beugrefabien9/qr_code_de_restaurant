<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\Restaurant;
use App\Models\Table;
use Database\Seeders\MenuImageSeeder;
use Database\Seeders\MenuSeeder;
use Database\Seeders\RestaurantSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Concerns\AuthenticatesPartnerApi;
use Tests\TestCase;

class PublicMenuApiTest extends TestCase
{
    use AuthenticatesPartnerApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RestaurantSeeder::class);
        $this->authenticatePartnerApi();
    }

    public function test_menu_uses_the_qr_token_table_and_database_products(): void
    {
        $table = Table::firstOrFail();

        $this->getJson("/api/public/menu/{$table->qr_token}/")
            ->assertOk()
            ->assertJsonPath('table.id', $table->id)
            ->assertJsonPath('table.number', $table->number)
            ->assertJsonPath('table.status', 'free')
            ->assertJsonPath('products.0.name', 'Burger Maison')
            ->assertJsonPath('products.0.category_name', 'Plats')
            ->assertJsonPath('products.0.available_quantity', 25);
    }

    public function test_unknown_qr_token_does_not_return_a_menu(): void
    {
        $this->getJson('/api/public/menu/invalid-token')
            ->assertNotFound()
            ->assertJsonPath('detail', 'Ce QR code ne correspond à aucune table.');
    }

    public function test_suspended_restaurant_menu_and_order_status_are_not_publicly_available(): void
    {
        $restaurant = Restaurant::firstOrFail();
        $table = Table::firstOrFail();
        $order = Order::with('items')->firstOrFail();
        $restaurant->update(['status' => 'suspended']);

        $this->getJson("/api/public/menu/{$table->qr_token}/")->assertNotFound();
        $this->getJson("/api/public/orders/{$order->id}?token={$table->qr_token}")->assertNotFound();
    }

    public function test_suspended_restaurant_cannot_receive_public_orders(): void
    {
        $restaurant = Restaurant::firstOrFail();
        $table = Table::firstOrFail();
        $product = Product::where('name', 'Burger Maison')->firstOrFail();
        $restaurant->update(['status' => 'suspended']);

        $this->postJson('/api/public/orders', [
            'table_token' => $table->qr_token,
            'order_type' => 'dine_in',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertNotFound();
    }

    public function test_products_endpoint_serializes_category_without_relation_collision(): void
    {
        $this->getJson('/api/products/')
            ->assertOk()
            ->assertJsonPath('0.category', 'Plats')
            ->assertJsonPath('0.category_name', 'Plats')
            ->assertJsonPath('1.category', 'Boissons')
            ->assertJsonPath('1.category_name', 'Boissons');
    }

    public function test_uploaded_product_image_is_stored_and_returned_in_public_menu(): void
    {
        Storage::fake('public');
        $restaurant = Restaurant::firstOrFail();
        $table = Table::firstOrFail();

        $response = $this->post('/api/products/', [
            'restaurant_id' => $restaurant->id,
            'name' => 'Salade illustrée',
            'description' => 'Salade avec photo.',
            'category' => 'Entrées',
            'price' => 2500,
            'available_quantity' => 5,
            'is_available' => true,
            'image' => UploadedFile::fake()->create('salade.jpg', 20, 'image/jpeg'),
        ])->assertCreated();

        $imageUrl = $response->json('image_url');
        $this->assertStringStartsWith('/storage/products/', $imageUrl);
        Storage::disk('public')->assertExists(substr($imageUrl, strlen('/storage/')));

        $menu = $this->getJson("/api/public/menu/{$table->qr_token}/")
            ->assertOk();
        $menuProduct = collect($menu->json('products'))->firstWhere('name', 'Salade illustrée');
        $this->assertSame($imageUrl, $menuProduct['image_url']);

        $this->patchJson("/api/products/{$response->json('id')}/", [
            'image_url' => 'https://example.com/salade.jpg',
        ])->assertOk()->assertJsonPath('image_url', 'https://example.com/salade.jpg');
        Storage::disk('public')->assertMissing(substr($imageUrl, strlen('/storage/')));
    }

    public function test_product_can_be_added_without_existing_products_or_restaurant_id_in_request(): void
    {
        $restaurant = Restaurant::firstOrFail();

        $this->postJson('/api/products/', [
            'name' => 'Nouveau dessert',
            'description' => 'Dessert du jour.',
            'price' => 1200,
            'available_quantity' => 4,
        ])->assertCreated()
            ->assertJsonPath('restaurant_id', $restaurant->id)
            ->assertJsonPath('name', 'Nouveau dessert');
    }

    public function test_product_can_be_updated_with_multipart_form_data_and_boolean_availability(): void
    {
        Storage::fake('public');
        $product = Product::where('name', 'Burger Maison')->firstOrFail();

        $this->post("/api/products/{$product->id}/", [
            '_method' => 'PATCH',
            'name' => $product->name,
            'description' => $product->description,
            'price' => $product->price,
            'preparation_time' => $product->preparation_time,
            'available_quantity' => $product->available_quantity,
            'is_available' => '1',
            'image' => UploadedFile::fake()->create('burger.jpg', 20, 'image/jpeg'),
        ])->assertOk()
            ->assertJsonPath('id', $product->id)
            ->assertJsonPath('is_available', true);
    }

    public function test_menu_seeder_adds_sample_items_without_duplicates_or_resetting_stock(): void
    {
        $this->seed(MenuSeeder::class);
        $burger = Product::where('name', 'Burger Maison')->firstOrFail();
        $burger->update(['available_quantity' => 7]);

        $this->seed(MenuSeeder::class);

        $this->assertDatabaseCount('categories', 4);
        $this->assertDatabaseCount('products', 13);
        $this->assertDatabaseHas('products', [
            'id' => $burger->id,
            'price' => 4500,
            'available_quantity' => 7,
        ]);
        $this->assertDatabaseHas('products', [
            'name' => 'Poulet braisé',
            'price' => 5000,
            'category' => 'Plats',
            'available_quantity' => 20,
        ]);
        $this->assertDatabaseHas('products', [
            'name' => 'Jus de bissap',
            'price' => 1000,
            'category' => 'Boissons',
        ]);
    }

    public function test_menu_image_seeder_assigns_local_illustrations_without_overwriting_custom_images(): void
    {
        $this->seed(MenuSeeder::class);
        Product::where('name', 'Café')->update(['image_url' => 'https://example.com/custom-coffee.jpg']);

        $this->seed(MenuImageSeeder::class);

        $this->assertDatabaseHas('products', [
            'name' => 'Burger Maison',
            'image_url' => '/menu-images/1f354.png',
        ]);
        $this->assertDatabaseHas('products', [
            'name' => 'Café',
            'image_url' => 'https://example.com/custom-coffee.jpg',
        ]);

        $table = Table::firstOrFail();
        $menu = $this->getJson("/api/public/menu/{$table->qr_token}/")->assertOk();
        $burger = collect($menu->json('products'))->firstWhere('name', 'Burger Maison');
        $this->assertSame('/menu-images/1f354.png', $burger['image_url']);
    }

    public function test_order_is_created_with_server_prices_and_client_notes(): void
    {
        $table = Table::firstOrFail();
        $product = Product::where('name', 'Burger Maison')->firstOrFail();

        $response = $this->postJson('/api/public/orders/', [
            'table_token' => $table->qr_token,
            'order_type' => 'dine_in',
            'note' => 'Sans oignons',
            'items' => [
                [
                    'product_id' => $product->id,
                    'quantity' => 2,
                    'note' => 'Bien cuit',
                ],
            ],
        ]);

        $response->assertCreated()
            ->assertJsonPath('order_type', 'dine_in')
            ->assertJsonPath('total_amount', 9000);

        $order = Order::with('items')->findOrFail($response->json('id'));
        $this->assertSame($table->id, $order->table_id);
        $this->assertSame('Sans oignons', $order->note);
        $this->assertSame('Bien cuit', $order->items->first()->note);
        $this->assertSame(9000.0, (float) $order->total_amount);
        $this->assertDatabaseHas('products', [
            'id' => $product->id,
            'available_quantity' => 23,
        ]);

        $this->getJson("/api/public/orders/{$order->id}?token={$table->qr_token}")
            ->assertOk()
            ->assertExactJson(['id' => $order->id, 'status' => 'pending']);
    }

    public function test_order_rejects_quantity_above_current_availability(): void
    {
        $table = Table::firstOrFail();
        $product = Product::where('name', 'Burger Maison')->firstOrFail();

        $this->postJson('/api/public/orders', [
            'table_token' => $table->qr_token,
            'order_type' => 'dine_in',
            'items' => [
                ['product_id' => $product->id, 'quantity' => 26],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('items');

        $this->assertDatabaseCount('orders', 1);
    }

    public function test_table_status_updates_use_the_frontend_status_values(): void
    {
        $table = Table::firstOrFail();

        $this->patchJson("/api/tables/{$table->id}/", ['status' => 'free'])
            ->assertOk()
            ->assertJsonPath('status', 'free')
            ->assertJsonPath('qr_code', $table->qr_token);

        $this->assertDatabaseHas('tables', [
            'id' => $table->id,
            'status' => 'available',
        ]);
    }
}
