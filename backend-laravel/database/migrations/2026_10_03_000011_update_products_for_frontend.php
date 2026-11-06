<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('category')->default('Plats')->after('status');
            $table->integer('preparation_time')->default(10)->after('category');
            $table->integer('available_quantity')->default(1)->after('preparation_time');
            $table->boolean('is_available')->default(true)->after('available_quantity');
            $table->boolean('is_active')->default(true)->after('is_available');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['category', 'preparation_time', 'available_quantity', 'is_available', 'is_active']);
        });
    }
};
